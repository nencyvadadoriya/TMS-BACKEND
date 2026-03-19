const mongoose = require('mongoose');

const headlineSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true
  },
  active: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['holiday', 'festival', 'meeting', 'update', 'other'],
    default: 'update'
  },
  expiresAt: {
    type: Date,
    required: false
  },
  bgColor: {
    type: String,
    required: false
  },
  textColor: {
    type: String,
    required: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Headline', headlineSchema);
