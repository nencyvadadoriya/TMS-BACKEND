const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const redisClient = require('../utils/redisClient');

const ChatMessage = require('../model/ChatMessage.model');
const { sendChatMessagePush } = require('../utils/pushNotifications.util');

let io;

function normalizeCompanyKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
}

function initSocket(server) {

    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            credentials: true,
        },
        // Increase ping intervals so connections don't die silently on slow networks
        pingTimeout: 60000,
        pingInterval: 25000,
        // Allow upgrade fallback to long-polling when WebSocket is blocked
        transports: ['websocket', 'polling'],
    });

    if (redisClient) {
        try {
            const pubClient = redisClient.duplicate({ maxRetriesPerRequest: null });
            const subClient = redisClient.duplicate({ maxRetriesPerRequest: null });

            pubClient.on('error', (err) => console.error('[Socket.IO] Redis Pub Error:', err.message));
            subClient.on('error', (err) => console.error('[Socket.IO] Redis Sub Error:', err.message));

            pubClient.on('connect', () => console.log('[Socket.IO] Redis pub client connected'));
            subClient.on('connect', () => console.log('[Socket.IO] Redis sub client connected'));

            pubClient.on('reconnecting', () => console.warn('[Socket.IO] Redis pub reconnecting…'));
            subClient.on('reconnecting', () => console.warn('[Socket.IO] Redis sub reconnecting…'));

            // Re-attach adapter after reconnection so rooms keep working
            pubClient.on('ready', () => {
                console.log('[Socket.IO] Redis pub client ready');
            });
            subClient.on('ready', () => {
                console.log('[Socket.IO] Redis sub client ready');
            });

            io.adapter(createAdapter(pubClient, subClient));
            console.log('[Socket.IO] Configured Redis horizontal scaling adapter successfully.');
        } catch (e) {
            console.error('[Socket.IO] Redis adapter failed to attach:', e.message);
            console.warn('[Socket.IO] Falling back to in-process adapter (single instance only).');
        }
    } else {
        console.warn('[Socket.IO] Redis not available — using in-process adapter (single instance, no horizontal scaling).');
    }

    io.on('error', (err) => {
        console.error('[Socket.IO] Server Error:', err.message);
    });

    io.on('connection', (socket) => {
        const auth = socket.handshake.auth || {};

        const userId = (auth.userId || '').toString().trim();
        const role = (auth.role || '').toString().trim().toLowerCase();
        const companyName = (auth.companyName || '').toString().trim();
        const companyKey = normalizeCompanyKey(companyName);

        console.log(`[Socket.IO] New connection: socketId=${socket.id}, userId=${userId || '(none)'}, role=${role}, company=${companyKey || '(none)'}`);

        if (companyKey) {
            socket.join(`company:${companyKey}`);
            console.log(`[Socket.IO] Joined company room: company:${companyKey}`);
        } else {
            console.warn(`[Socket.IO] ⚠️  userId=${userId} connected with NO companyName — will not join a company room. Task events emitted to company rooms will be missed!`);
        }

        if (userId) {
            socket.join(`user:${userId}`);
            console.log(`[Socket.IO] Joined personal room: user:${userId}. All rooms: ${Array.from(socket.rooms).join(', ')}`);

            if (companyKey) {
                socket.to(`company:${companyKey}`).emit('user_online', userId);
            } else {
                socket.broadcast.emit('user_online', userId);
            }
        }

        if (role === 'admin' || role === 'super_admin') {
            socket.join('role:admin-like');
            console.log(`[Socket.IO] Joined admin room: role:admin-like`);
        }

        socket.on('get_online_users', (data, callback) => {
            const onlineUsers = [];
            const rooms = io.of('/').adapter.rooms;
            for (const [roomName, socketIds] of rooms.entries()) {
                if (roomName.startsWith('user:') && socketIds.size > 0) {
                    onlineUsers.push(roomName.replace('user:', ''));
                }
            }
            if (callback) callback(onlineUsers);
        });

        socket.on('send_message', async (data, callback) => {
            try {
                const { receiverId, content } = data;
                const senderId = userId;

                const senderName = (data?.senderName || auth.userName || 'Unknown').toString();
                const senderEmail = (data?.senderEmail || auth.userEmail || 'unknown@example.com').toString();

                if (!receiverId || !content) {
                    return callback({ error: 'Receiver ID and content are required' });
                }

                const doc = await ChatMessage.create({
                    senderId,
                    senderName,
                    senderEmail,
                    receiverId,
                    content: content.trim(),
                    read: false,
                });

                const message = {
                    id: String(doc._id),
                    senderId: doc.senderId,
                    senderName: doc.senderName,
                    senderEmail: doc.senderEmail,
                    receiverId: doc.receiverId,
                    content: doc.content,
                    timestamp: doc.timestamp,
                    read: doc.read,
                };

                io.to(`user:${senderId}`).emit('chat_list_update', {
                    otherUserId: receiverId,
                    lastMessageAt: message.timestamp,
                    unreadIncrement: 0,
                });

                io.to(`user:${receiverId}`).emit('chat_list_update', {
                    otherUserId: senderId,
                    lastMessageAt: message.timestamp,
                    unreadIncrement: 1,
                });

                try {
                    await sendChatMessagePush({
                        toUserId: receiverId,
                        fromName: message.senderName,
                        messageText: message.content,
                        senderId: senderId,
                    });
                } catch (e) {
                    // push notification failure is non-critical
                }

                io.to(`user:${receiverId}`).emit('new_message', message);

                callback(message);

            } catch (error) {
                console.error('Error sending message:', error);
                callback({ error: 'Failed to send message' });
            }
        });

        socket.on('get_chat_history', async (data, callback) => {
            try {
                const { userId: peerUserId, page = 1, limit = 50 } = data;
                const currentUserId = userId;

                if (!peerUserId) {
                    return callback({ error: 'userId is required' });
                }

                const pageNum = Math.max(1, Number(page) || 1);
                const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
                const skip = (pageNum - 1) * limitNum;

                const docs = await ChatMessage.find({
                    $or: [
                        { senderId: currentUserId, receiverId: String(peerUserId) },
                        { senderId: String(peerUserId), receiverId: currentUserId },
                    ],
                })
                    .sort({ timestamp: -1 })
                    .skip(skip)
                    .limit(limitNum)
                    .lean();

                const messages = docs.map((d) => ({
                    id: String(d._id),
                    senderId: d.senderId,
                    senderName: d.senderName,
                    senderEmail: d.senderEmail,
                    receiverId: d.receiverId,
                    content: d.content,
                    timestamp: d.timestamp,
                    read: d.read,
                }));

                callback({ messages });
            } catch (error) {
                console.error('Error fetching chat history:', error);
                callback({ error: 'Failed to fetch chat history' });
            }
        });

        socket.on('disconnect', async (reason) => {
            console.log(`[Socket.IO] Socket ${socket.id} (userId=${userId}) disconnected. Reason: ${reason}`);
            if (userId) {
                const activeSockets = await io.in(`user:${userId}`).fetchSockets();
                if (activeSockets.length === 0) {
                    if (companyKey) {
                        io.to(`company:${companyKey}`).emit('user_offline', userId);
                    } else {
                        io.emit('user_offline', userId);
                    }
                }
            }
        });
    });

    return io;
}

function getIO() {
    if (!io) {
        throw new Error('Socket.io has not been initialized');
    }
    return io;
}

module.exports = {
    initSocket,
    getIO,
    normalizeCompanyKey,
};
