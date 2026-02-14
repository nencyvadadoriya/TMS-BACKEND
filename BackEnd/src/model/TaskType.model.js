const mongoose = require('mongoose');

const taskTypeSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: false,
    default: null,
    index: true
  },
  brandId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand',
    required: false,
    default: null,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null,
    index: true
  },
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
  }
}, {
  timestamps: true,
  versionKey: false
});

taskTypeSchema.index({ companyId: 1, brandId: 1, userId: 1, name: 1 }, { unique: true });
taskTypeSchema.index({ name: 1 });

module.exports = mongoose.model('TaskType', taskTypeSchema);