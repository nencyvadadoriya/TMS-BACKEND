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
    });

    if (redisClient) {
        try {
            // The adapter requires dedicated connection pooling that never aborts even if Redis drops momentarily
            const pubClient = redisClient.duplicate({ maxRetriesPerRequest: null });
            const subClient = redisClient.duplicate({ maxRetriesPerRequest: null });
            
            pubClient.on('error', () => {}); // Swallow silent network dropping
            subClient.on('error', () => {}); 

            io.adapter(createAdapter(pubClient, subClient));
            console.log('[Socket.IO] Configured Redis horizontal scaling adapter successfully.');
        } catch (e) {
            console.error('[Socket.IO] Redis adapter failed to attach:', e.message);
        }
    }

    io.on('connection', (socket) => {
        console.log('New socket connection established');
        console.log('Socket ID:', socket.id);
        
        const auth = socket.handshake.auth || {};

        const userId = (auth.userId || '').toString();
        const role = (auth.role || '').toString().trim().toLowerCase();
        const companyName = (auth.companyName || '').toString();

        const companyKey = normalizeCompanyKey(companyName);

        if (companyKey) {
            socket.join(`company:${companyKey}`);
        }

        if (userId) {
            socket.join(`user:${userId}`);
            console.log(`User ${userId} joined their personal room: user:${userId}`);
            console.log('Rooms now:', Array.from(socket.rooms || []));
            
            // Notify others in company (or global) that user is online
            if (companyKey) {
                socket.to(`company:${companyKey}`).emit('user_online', userId);
            } else {
                socket.broadcast.emit('user_online', userId);
            }
        }

        if (role === 'admin' || role === 'super_admin') {
            socket.join('role:admin-like');
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

        // Handle sending messages
        socket.on('send_message', async (data, callback) => {
            
            try {
                const { receiverId, content } = data;
                const senderId = userId;

                const senderName = (data?.senderName || auth.userName || 'Unknown').toString();
                const senderEmail = (data?.senderEmail || auth.userEmail || 'unknown@example.com').toString();

                if (!receiverId || !content) {
                    console.log('Invalid message data:', { receiverId, content });
                    return callback({ error: 'Receiver ID and content are required' });
                }

                // Persist message
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
                }

                // Send to receiver if they're online
                const receiverSockets = await io.in(`user:${receiverId}`).fetchSockets();
                
                if (receiverSockets.length > 0) {
                    io.to(`user:${receiverId}`).emit('new_message', message);
                } else {
                }

                // Send confirmation to sender
                callback(message);

            } catch (error) {
                console.error('Error sending message:', error);
                callback({ error: 'Failed to send message' });
            }
        });

        // Handle getting chat history
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
            console.log('Socket disconnected:', socket.id, 'Reason:', reason);
            if (userId) {
                // Check if user still has other active sockets
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
