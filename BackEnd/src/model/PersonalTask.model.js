const mongoose = require('mongoose');

const personalTaskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed'],
    default: 'pending',
    trim: true,
    index: true
  },
  purpose: {
    type: String,
    default: '',
    trim: true
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  reminderStyle: {
    type: String,
    enum: ['none', 'once', 'daily', 'weekly'],
    default: 'none',
    trim: true
  },
  reminderAt: {
    type: Date,
    default: null
  },
  companyName: {
    type: String,
    default: '',
    trim: true
  },
  creatorEmail: {
    type: String,
    required: [true, 'Creator email is required'],
    trim: true,
    lowercase: true,
    index: true
  },
  creatorUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  }
}, {
  timestamps: true,
  versionKey: false
});

personalTaskSchema.index({ creatorEmail: 1, createdAt: -1 });
personalTaskSchema.index({ creatorEmail: 1, status: 1, createdAt: -1 });
personalTaskSchema.index({ reminderStyle: 1, reminderAt: 1 });

const PersonalTask = mongoose.model('PersonalTask', personalTaskSchema);

module.exports = PersonalTask;
