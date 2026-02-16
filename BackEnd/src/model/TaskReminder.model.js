const mongoose = require('mongoose');

const taskReminderSchema = new mongoose.Schema({
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
    index: true
  },
  toEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  toUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  fromEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  fromUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  message: {
    type: String,
    trim: true,
    default: ''
  },
  seen: {
    type: Boolean,
    default: false,
    index: true
  },
  seenAt: {
    type: Date,
    default: null
  },
  taskSnapshot: {
    title: { type: String, default: '', trim: true },
    dueDate: { type: Date, default: null },
    status: { type: String, default: '', trim: true },
    companyName: { type: String, default: '', trim: true },
    brand: { type: String, default: '', trim: true },
  }
}, {
  timestamps: true,
  versionKey: false
});

taskReminderSchema.index({ toEmail: 1, seen: 1, createdAt: -1 });

taskReminderSchema.methods.toClient = function () {
  return {
    id: this._id ? String(this._id) : '',
    taskId: this.taskId ? String(this.taskId) : '',
    toEmail: this.toEmail,
    fromEmail: this.fromEmail,
    message: this.message || '',
    seen: Boolean(this.seen),
    seenAt: this.seenAt,
    createdAt: this.createdAt,
    task: {
      title: this.taskSnapshot?.title || '',
      dueDate: this.taskSnapshot?.dueDate || null,
      status: this.taskSnapshot?.status || '',
      companyName: this.taskSnapshot?.companyName || '',
      brand: this.taskSnapshot?.brand || '',
    }
  };
};

const TaskReminder = mongoose.model('TaskReminder', taskReminderSchema);

module.exports = TaskReminder;
