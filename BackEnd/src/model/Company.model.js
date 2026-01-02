const mongoose = require('mongoose');

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
  }
}, {
  timestamps: true,
  versionKey: false
});

companySchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Company', companySchema);
