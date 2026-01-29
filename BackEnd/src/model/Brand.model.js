const mongoose = require('mongoose');

const collaboratorSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['editor', 'viewer'],
    default: 'viewer'
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['active', 'accepted', 'invited', 'pending', 'declined', 'removed'],
    default: 'invited'
  }
});

const historySchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'created',
      'updated',
      'deleted',
      'restored',
      'collaborator_added',
      'collaborator_removed',
      'status_changed',
      'brand_created',
      'brand_updated',
      'brand_deleted',
      'collaborator_invited',
      'collaborator_accepted',
      'collaborator_declined'
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

const brandSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  company: {
    type: String,
    default: '',
    trim: true
  },
  category: {
    type: String,
    default: 'Other',
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'archived', 'deleted'],
    default: 'active'
  },
  website: {
    type: String,
    default: '',
    trim: true
  },
  logo: {
    type: String,
    default: ''
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  collaborators: {
    type: [collaboratorSchema],
    default: []
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
  versionKey: false,
  // Virtuals for soft delete
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Middleware to auto-set deletedAt and isDeleted
brandSchema.pre('save', async function() {
  if (this.status === 'deleted' && !this.deletedAt) {
    this.deletedAt = new Date();
    this.isDeleted = true;
  } else if (this.status !== 'deleted') {
    this.deletedAt = null;
    this.deletedBy = null;
    this.isDeleted = false;
    this.deleteReason = '';
  }
});

// FIXED: Query middleware - proper implementation
brandSchema.pre(/^find/, function() {
  // Check if we're querying for deleted items
  const filter = this.getFilter();
  const options = typeof this.getOptions === 'function' ? this.getOptions() : (this.options || {});

  if (options && options.includeDeleted) {
    return;
  }

  const hasDeletedPredicate = (node) => {
    if (!node) return false;
    if (Array.isArray(node)) return node.some(hasDeletedPredicate);
    if (typeof node !== 'object') return false;

    if (node.status === 'deleted' || node.isDeleted === true) return true;

    if (node.$or && hasDeletedPredicate(node.$or)) return true;
    if (node.$and && hasDeletedPredicate(node.$and)) return true;

    return Object.values(node).some(hasDeletedPredicate);
  };
  
  // If we're explicitly looking for deleted items, don't modify the query
  if (hasDeletedPredicate(filter) || filter.status === 'deleted' || filter.isDeleted === true) {
    return;
  }
  
  // If we're looking for specific status other than deleted, don't modify
  if (filter.status && filter.status !== 'deleted') {
    return;
  }
  
  // Otherwise, exclude deleted items by default
  this.where({
    $and: [
      {
        $or: [
          { status: { $ne: 'deleted' } },
          { status: { $exists: false } }
        ]
      },
      {
        $or: [
          { isDeleted: { $ne: true } },
          { isDeleted: { $exists: false } }
        ]
      }
    ]
  });
});

// Alternative approach: Use a query helper instead of middleware
brandSchema.query.excludeDeleted = function() {
  return this.where({
    $and: [
      {
        $or: [
          { status: { $ne: 'deleted' } },
          { status: { $exists: false } }
        ]
      },
      {
        $or: [
          { isDeleted: { $ne: true } },
          { isDeleted: { $exists: false } }
        ]
      }
    ]
  });
};

brandSchema.query.includeDeleted = function() {
  return this;
};

// Virtual for checking if brand is deleted
brandSchema.virtual('isActive').get(function() {
  return this.status === 'active' && !this.isDeleted;
});

// Static methods
brandSchema.statics.findActive = function() {
  return this.find({ 
    status: 'active',
    isDeleted: false 
  });
};

brandSchema.statics.findDeleted = function() {
  return this.find({ 
    $or: [
      { status: 'deleted' },
      { isDeleted: true }
    ]
  });
};

brandSchema.statics.softDelete = async function(id, userId, reason = '') {
  return this.findByIdAndUpdate(id, {
    status: 'deleted',
    deletedAt: new Date(),
    deletedBy: userId,
    isDeleted: true,
    deleteReason: reason
  }, { new: true }).setOptions({ includeDeleted: true });
};

brandSchema.statics.restore = async function(id) {
  return this.findByIdAndUpdate(id, {
    status: 'active',
    deletedAt: null,
    deletedBy: null,
    isDeleted: false,
    deleteReason: ''
  }, { new: true }).setOptions({ includeDeleted: true });
};

// Indexes
brandSchema.index({ owner: 1, createdAt: -1 });
brandSchema.index({ 'collaborators.email': 1 });
brandSchema.index({ status: 1 });
brandSchema.index({ isDeleted: 1 });
brandSchema.index({ deletedAt: 1 });
brandSchema.index({ owner: 1, isDeleted: 1 });

const Brand = mongoose.model('Brand', brandSchema);

module.exports = Brand;