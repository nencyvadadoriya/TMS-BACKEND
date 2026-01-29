const mongoose = require('mongoose');

const taskTypeSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
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

taskTypeSchema.index({ companyId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('TaskType', taskTypeSchema);