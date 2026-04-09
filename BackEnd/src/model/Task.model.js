const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: String,
    trim: true,
    lowercase: true,
    default: null
  },
  taskType: {
    type: String,
    default: 'regular',
    trim: true
  },
  companyName: {
    type: String,
    default: '',
    trim: true
  },
  brand: {
    type: String,
    default: '',
    trim: true
  },
  brandId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand',
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'reassigned'],
    default: 'pending'
  },
  statusUpdatedAt: {
    type: Date,
    default: Date.now
  },
  completedApproval: {
    type: Boolean,
    default: false
  },
  reviewStars: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },
  reviewComment: {
    type: String,
    trim: true,
    default: ''
  },
  reviewedBy: {
    type: String,
    trim: true,
    lowercase: true,
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  dueDate: {
    type: Date,
    required: [true, 'Due date is required']
  },
  assignedTo: {
    type: String,
    trim: true,
    lowercase: true,
    required: [true, 'Assignee email is required']
  },
  assignedBy: {
    type: String,
    trim: true,
    lowercase: true,
    required: [true, 'Assigner email is required']
  },
  obManagerEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: null
  },
  // Store comment references
  comments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: []
  }],
  // Store history references
  history: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaskHistory',
    default: []
  }],
  invitations: [{
    email: { type: String, required: true },
    role: { type: String, default: 'viewer' },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    invitedBy: { type: String },
    invitedAt: { type: Date, default: Date.now }
  }],
  googleSync: {
    taskId: {
      type: String,
      default: null
    },
    tasklistId: {
      type: String,
      default: '@default'
    },
    ownerEmail: {
      type: String,
      default: null,
      trim: true,
      lowercase: true
    },
    syncedAt: {
      type: Date,
      default: null
    },
    googleUpdatedAt: {
      type: Date,
      default: null
    },
    lastError: {
      type: String,
      default: null
    }
  },
  latestComment: {
    content: { type: String, default: null },
    userName: { type: String, default: null },
    userEmail: { type: String, default: null },
    createdAt: { type: Date, default: null }
  }
}, {
  timestamps: true,
  versionKey: false
});

// Indexes
taskSchema.index({ status: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ assignedTo: 1 });
taskSchema.index({ assignedBy: 1 });
taskSchema.index({ obManagerEmail: 1 });
taskSchema.index({ completedApproval: 1 });
taskSchema.index({ reviewStars: 1 });
taskSchema.index({ reviewedAt: -1 });
taskSchema.index({ companyName: 1 });
taskSchema.index({ taskType: 1 });
taskSchema.index({ isDeleted: 1, completedApproval: 1, createdAt: -1 });
taskSchema.index({ assignedTo: 1, isDeleted: 1, completedApproval: 1, createdAt: -1 });
taskSchema.index({ assignedBy: 1, isDeleted: 1, completedApproval: 1, createdAt: -1 });
taskSchema.index({ obManagerEmail: 1, isDeleted: 1, completedApproval: 1, createdAt: -1 });
taskSchema.index({ 'googleSync.taskId': 1 });
taskSchema.index({ 'googleSync.taskId': 1, 'googleSync.ownerEmail': 1 });

// Virtual for comment count
taskSchema.virtual('commentCount').get(function () {
  return this.comments?.length || 0;
});

const Task = mongoose.model('Task', taskSchema);

module.exports = Task;