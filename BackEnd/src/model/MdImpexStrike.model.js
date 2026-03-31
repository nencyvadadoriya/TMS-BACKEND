const mongoose = require('mongoose');

const MdImpexStrikeSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    time: { type: String, required: true },
    poc: {
      name: { type: String, required: true },
      email: { type: String, required: true }
    },
    brandName: { type: String },
    strikeTitle: { type: String, required: true },
    assignBy: {
      name: { type: String },
      email: { type: String, required: true }
    },
    company: { type: String, default: 'MD-Impex' },
    reason: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.models.MdImpexStrike || mongoose.model('MdImpexStrike', MdImpexStrikeSchema);
