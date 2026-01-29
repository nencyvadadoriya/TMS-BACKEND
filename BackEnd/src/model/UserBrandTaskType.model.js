const mongoose = require('mongoose');

const userBrandTaskTypeSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true,
    default: ''
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
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

userBrandTaskTypeSchema.index({ companyName: 1, userId: 1 });

userBrandTaskTypeSchema.index({ companyName: 1, userId: 1, brandId: 1 }, { unique: true });

module.exports = mongoose.model('UserBrandTaskType', userBrandTaskTypeSchema);
