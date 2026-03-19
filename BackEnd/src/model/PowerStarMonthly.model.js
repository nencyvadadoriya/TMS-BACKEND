const mongoose = require('mongoose');

const PowerStarMonthlyRowSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    role: { type: String, default: '' },
    position: { type: String, default: '' },
    avatar: { type: String, default: '' },
    churn: { type: [Number], default: [0, 0, 0, 0] },
    liveAssign: { type: [Number], default: [0, 0, 0, 0] },
    hits: { type: [Number], default: [0, 0, 0, 0] },
    freeze: { type: Boolean, default: false },
    freezeChurn: { type: Boolean, default: false },
    freezeLiveAssign: { type: Boolean, default: false },
    freezeHits: { type: Boolean, default: false }
  },
  { _id: false }
);

const PowerStarMonthlySchema = new mongoose.Schema(
  {
    monthKey: { type: String, required: true, index: true },
    companyName: { type: String, default: '' },
    rows: { type: [PowerStarMonthlyRowSchema], default: [] },
    updatedBy: { type: String, default: '' },
    updatedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

PowerStarMonthlySchema.index({ monthKey: 1, companyName: 1 }, { unique: true });

module.exports = mongoose.models.PowerStarMonthly || mongoose.model('PowerStarMonthly', PowerStarMonthlySchema);
