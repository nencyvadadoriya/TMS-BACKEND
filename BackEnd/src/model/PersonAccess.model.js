const mongoose = require('mongoose');

const PersonAccessSchema = new mongoose.Schema({
  assignedToEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  assignedToName: {
    type: String,
    required: true,
    trim: true,
  },
  assignedToRole: {
    type: String,
    required: true,
    trim: true,
  },
  accessRole: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: false,
    trim: true,
  },
  allowedAssignees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  allowedTaskTypes: {
    type: [String],
    default: [],
    trim: true,
  },
  allowedBrands: {
    type: [String],
    default: [],
    trim: true,
  },
  companyName: {
    type: String,
    required: true,
    trim: true,
    default: 'MD Impex',
  },
  createdBy: {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    name: String,
    email: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for unique person+company combination (role optional)
PersonAccessSchema.index({ assignedToEmail: 1, assignedToRole: 1, companyName: 1 }, { unique: true });

module.exports = mongoose.model('PersonAccess', PersonAccessSchema);
