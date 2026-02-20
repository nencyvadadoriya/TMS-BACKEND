const mongoose = require('mongoose');

const companyTaskTypeSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: false,
    default: null,
    // indexed via companyTaskTypeSchema.index below
  },
  companyName: {
    type: String,
    required: true,
    trim: true,
    default: ''
  },
  taskTypeIds: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'TaskType',
    default: []
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

companyTaskTypeSchema.index({ companyId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('CompanyTaskType', companyTaskTypeSchema);
