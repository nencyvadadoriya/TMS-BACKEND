const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    senderId: {
      type: String,
      required: true,
      index: true,
    },
    senderName: {
      type: String,
      default: '',
    },
    senderEmail: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    receiverId: {
      type: String,
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: 'timestamp', updatedAt: false },
    versionKey: false,
  }
);

chatMessageSchema.index({ senderId: 1, receiverId: 1, timestamp: -1 });
chatMessageSchema.index({ receiverId: 1, senderId: 1, timestamp: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
