const mongoose = require('mongoose');

const companyBrandTaskTypeSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true,
    default: ''
  },
  brandId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand',
    required: true,
    index: true
  },
  brandName: {
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

companyBrandTaskTypeSchema.index({ brandId: 1 }, { unique: true });
companyBrandTaskTypeSchema.index({ companyName: 1, brandName: 1 });

module.exports = mongoose.model('CompanyBrandTaskType', companyBrandTaskTypeSchema);
