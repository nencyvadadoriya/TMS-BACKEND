// backend/models/TaskHistory.js
const mongoose = require('mongoose');

const taskHistorySchema = new mongoose.Schema({
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true
  },
  action: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  note: {
    type: String,
    default: ''
  },
  oldStatus: {
    type: String,
    default: null
  },
  newStatus: {
    type: String,
    default: null
  },
  userId: {
    type: String,
    required: true
  },
  user: {
    userId: {
      type: String
    },
    userName: String,
    userEmail: String,
    userRole: String
  },
  additionalData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, {
  timestamps: { createdAt: 'timestamp', updatedAt: false },
  versionKey: false
});

taskHistorySchema.index({ taskId: 1, timestamp: -1 });
taskHistorySchema.index({ userId: 1 });

const TaskHistory = mongoose.model('TaskHistory', taskHistorySchema);

module.exports = TaskHistory;