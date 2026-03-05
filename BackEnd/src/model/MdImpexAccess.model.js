const mongoose = require('mongoose');

const MdImpexAccessSchema = new mongoose.Schema(
  {
    role: { 
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
      index: true 
    },
    emails: { 
      type: [String], 
      default: [],
      index: true 
    },
    companyName: { 
      type: String, 
      default: 'MD Impex',
      trim: true,
      index: true 
    },
    description: {
      type: String,
      default: '',
      trim: true
    },
    createdBy: {
      id: { type: String },
      name: { type: String },
      email: { type: String }
    }
  },
  { timestamps: true }
);

// Compound index to ensure unique roles per company
MdImpexAccessSchema.index({ role: 1, companyName: 1 }, { unique: true });

module.exports = mongoose.models.MdImpexAccess || mongoose.model('MdImpexAccess', MdImpexAccessSchema);
