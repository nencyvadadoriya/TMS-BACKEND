// Message Model for Chat System
// Add this to your backend models folder

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderName: {
    type: String,
    required: true
  },
  senderEmail: {
    type: String,
    required: true
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 2000 // Limit message length
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },
  // For future features
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'system'],
    default: 'text'
  },
  fileUrl: {
    type: String
  },
  edited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  },
  deleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date
  }
}, {
  timestamps: true // Adds createdAt and updatedAt automatically
});

// Indexes for better query performance
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, read: 1, createdAt: -1 });
messageSchema.index({ createdAt: -1 });

// Virtual for conversation ID (useful for grouping)
messageSchema.virtual('conversationId').get(function() {
  const participants = [this.senderId, this.receiverId].sort();
  return `${participants[0]}_${participants[1]}`;
});

// Method to mark as read
messageSchema.methods.markAsRead = function() {
  this.read = true;
  this.readAt = new Date();
  return this.save();
};

// Static method to get conversation between two users
messageSchema.statics.getConversation = function(userId1, userId2, page = 1, limit = 50) {
  return this.find({
    $or: [
      { senderId: userId1, receiverId: userId2 },
      { senderId: userId2, receiverId: userId1 }
    ],
    deleted: false
  })
  .sort({ createdAt: -1 })
  .skip((page - 1) * limit)
  .limit(limit)
  .populate('senderId', 'name email avatar')
  .populate('receiverId', 'name email avatar');
};

// Static method to get unread message count for user
messageSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({
    receiverId: userId,
    read: false,
    deleted: false
  });
};

// Static method to get chat rooms (conversations list)
messageSchema.statics.getChatRooms = function(userId) {
  return this.aggregate([
    {
      $match: {
        $or: [{ senderId: mongoose.Types.ObjectId(userId) }, { receiverId: mongoose.Types.ObjectId(userId) }],
        deleted: false
      }
    },
    {
      $sort: { createdAt: -1 }
    },
    {
      $group: {
        _id: {
          $cond: {
            if: { $eq: ['$senderId', mongoose.Types.ObjectId(userId)] },
            then: '$receiverId',
            else: '$senderId'
          }
        },
        lastMessage: { $first: '$$ROOT' },
        unreadCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$receiverId', mongoose.Types.ObjectId(userId)] }, { $eq: ['$read', false] }] },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'otherUser'
      }
    },
    {
      $unwind: '$otherUser'
    },
    {
      $project: {
        id: '$otherUser._id',
        name: '$otherUser.name',
        email: '$otherUser.email',
        avatar: '$otherUser.avatar',
        role: '$otherUser.role',
        lastMessage: 1,
        unreadCount: 1
      }
    },
    {
      $sort: { 'lastMessage.createdAt': -1 }
    }
  ]);
};

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
