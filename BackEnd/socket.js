// Backend Socket.io Server Setup
// Add this to your backend server.js or create a separate socket.js file

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./model/user.model'); // Adjust path as needed

// Initialize Socket.io
const initializeSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Authentication middleware for Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const userId = socket.handshake.auth.userId;

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from database
      const user = await User.findById(decoded.id || decoded.userId);
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      // Attach user to socket
      socket.user = user;
      socket.userId = user._id.toString();
      
      console.log(`🔌 User ${user.email} connected via socket`);
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication error'));
    }
  });

  // Handle connections
  io.on('connection', (socket) => {
    console.log(`🔌 User connected: ${socket.user.email}`);

    // Join user's personal room for direct messages
    socket.on('join_user_room', (data) => {
      const userId = socket.userId;
      socket.join(`user_${userId}`);
      
      // Update user's online status
      socket.broadcast.emit('user_online', userId);
      
      console.log(`📱 ${socket.user.email} joined their personal room`);
    });

    // Send direct message
    socket.on('send_message', async (data, callback) => {
      try {
        const { receiverId, content } = data;
        const senderId = socket.userId;

        // Validate data
        if (!receiverId || !content) {
          return callback({ error: 'Receiver ID and content are required' });
        }

        // Get receiver's socket
        const receiverSockets = await io.in(`user_${receiverId}`).fetchSockets();
        
        // Create message object
        const message = {
          id: new Date().getTime().toString(), // Unique ID
          senderId,
          senderName: socket.user.name,
          senderEmail: socket.user.email,
          receiverId,
          content: content.trim(),
          timestamp: new Date(),
          read: false
        };

        // Send to receiver if online
        if (receiverSockets.length > 0) {
          io.to(`user_${receiverId}`).emit('new_message', message);
          console.log(`📨 Message sent from ${socket.user.email} to user ${receiverId}`);
        }

        // Send confirmation to sender
        callback(message);

        // TODO: Save message to database
        // await Message.create(message);

      } catch (error) {
        console.error('Error sending message:', error);
        callback({ error: 'Failed to send message' });
      }
    });

    // Get chat history
    socket.on('get_chat_history', async (data, callback) => {
      try {
        const { userId, page = 1, limit = 50 } = data;
        const currentUserId = socket.userId;

        // TODO: Fetch from database
        // const messages = await Message.find({
        //   $or: [
        //     { senderId: currentUserId, receiverId: userId },
        //     { senderId: userId, receiverId: currentUserId }
        //   ]
        // })
        // .sort({ timestamp: -1 })
        // .skip((page - 1) * limit)
        // .limit(limit);

        // For now, return empty array
        const messages = [];

        callback({ messages });
      } catch (error) {
        console.error('Error fetching chat history:', error);
        callback({ error: 'Failed to fetch chat history' });
      }
    });

    // Mark message as read
    socket.on('mark_message_read', async (data, callback) => {
      try {
        const { messageId, readerId } = data;
        
        // TODO: Update message in database
        // await Message.findByIdAndUpdate(messageId, { read: true });

        // Notify sender that message was read
        const message = { messageId, readerId };
        socket.broadcast.emit('message_read', message);

        callback({ success: true });
      } catch (error) {
        console.error('Error marking message as read:', error);
        callback({ error: 'Failed to mark message as read' });
      }
    });

    // Get chat rooms (conversations)
    socket.on('get_chat_rooms', async (data, callback) => {
      try {
        const userId = socket.userId;

        // TODO: Fetch from database
        // const rooms = await Message.aggregate([
        //   { $match: { $or: [{ senderId: userId }, { receiverId: userId }] } },
        //   { $sort: { timestamp: -1 } },
        //   { $group: {
        //     _id: {
        //       $cond: {
        //         if: { $eq: ['$senderId', userId] },
        //         then: '$receiverId',
        //         else: '$senderId'
        //       }
        //     },
        //     lastMessage: { $first: '$$ROOT' },
        //     unreadCount: {
        //       $sum: {
        //         $cond: [
        //           { $and: [{ $eq: ['$receiverId', userId] }, { $eq: ['$read', false] }] },
        //           1,
        //           0
        //         ]
        //       }
        //     }
        //   }}
        // ]);

        // For now, return empty array
        const rooms = [];

        callback({ rooms });
      } catch (error) {
        console.error('Error fetching chat rooms:', error);
        callback({ error: 'Failed to fetch chat rooms' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`🔌 User disconnected: ${socket.user.email}, reason: ${reason}`);
      
      // Notify others that user went offline
      socket.broadcast.emit('user_offline', socket.userId);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.user.email}:`, error);
    });
  });

  return io;
};

module.exports = initializeSocket;
