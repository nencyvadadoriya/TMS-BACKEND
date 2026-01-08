const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'created',
      'updated',
      'deleted',
      'restored',
      'company_created',
      'company_updated',
      'company_deleted'
    ]
  },
  field: {
    type: String,
    default: ''
  },
  oldValue: mongoose.Schema.Types.Mixed,
  newValue: mongoose.Schema.Types.Mixed,
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null
  },
  userId: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  userName: {
    type: String,
    default: ''
  },
  userEmail: {
    type: String,
    default: ''
  },
  userRole: {
    type: String,
    default: ''
  },
  message: {
    type: String,
    default: ''
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  performedAt: {
    type: Date,
    default: Date.now
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    default: ''
  }
});

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: String,
    default: ''
  },
  updatedBy: {
    type: String,
    default: ''
  },
  history: {
    type: [historySchema],
    default: []
  },
  // Soft delete fields
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deleteReason: {
    type: String,
    default: ''
  }
}, {
  timestamps: true,
  versionKey: false
});

// Middleware to auto-set deletedAt and isDeleted
companySchema.pre('save', async function() {
  if (this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  } else if (!this.isDeleted) {
    this.deletedAt = null;
    this.deletedBy = null;
    this.deleteReason = '';
  }
});

// Static methods for history tracking
companySchema.statics.addHistory = async function(companyId, historyData) {
  return this.findByIdAndUpdate(
    companyId,
    { $push: { history: { ...historyData, timestamp: new Date() } } },
    { new: true }
  );
};

companySchema.statics.softDelete = async function(id, userId, reason = '') {
  const company = await this.findById(id);
  if (company) {
    await this.addHistory(id, {
      action: 'company_deleted',
      performedBy: userId,
      message: `Company deleted: ${reason}`,
      oldValue: { name: company.name, isActive: company.isActive },
      newValue: { isDeleted: true, deleteReason: reason }
    });
  }
  
  return this.findByIdAndUpdate(id, {
    isActive: false,
    deletedAt: new Date(),
    deletedBy: userId,
    isDeleted: true,
    deleteReason: reason
  }, { new: true });
};

companySchema.statics.restore = async function(id, userId) {
  const company = await this.findById(id);
  if (company) {
    await this.addHistory(id, {
      action: 'restored',
      performedBy: userId,
      message: 'Company restored',
      oldValue: { isDeleted: true, deleteReason: company.deleteReason },
      newValue: { isDeleted: false, isActive: true }
    });
  }
  
  return this.findByIdAndUpdate(id, {
    isActive: true,
    deletedAt: null,
    deletedBy: null,
    isDeleted: false,
    deleteReason: ''
  }, { new: true });
};

companySchema.index({ name: 1 }, { unique: true });
companySchema.index({ isDeleted: 1 });
companySchema.index({ deletedAt: 1 });

module.exports = mongoose.model('Company', companySchema);
