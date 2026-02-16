const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    index: true
  },
  deviceId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  platform: {
    type: String,
    default: 'web'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  userEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: null,
    index: true
  },
  userAgent: {
    type: String,
    default: ''
  },
  lastSeenAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  revoked: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true,
  versionKey: false
});

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);
