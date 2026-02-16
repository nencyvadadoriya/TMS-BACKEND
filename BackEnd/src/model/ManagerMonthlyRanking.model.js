const mongoose = require('mongoose');

const ManagerMonthlyRankingRowSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    role: { type: String, default: '' },
    position: { type: String, default: '' },
    avatar: { type: String, default: '' },
    assign: { type: Number, default: 0 },
    achieved: { type: Number, default: 0 }
  },
  { _id: false }
);

const ManagerMonthlyRankingSchema = new mongoose.Schema(
  {
    monthKey: { type: String, required: true, index: true },
    companyName: { type: String, default: '' },
    rows: { type: [ManagerMonthlyRankingRowSchema], default: [] },
    updatedBy: { type: String, default: '' },
    updatedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

ManagerMonthlyRankingSchema.index({ monthKey: 1, companyName: 1 }, { unique: true });

module.exports = mongoose.models.ManagerMonthlyRanking || mongoose.model('ManagerMonthlyRanking', ManagerMonthlyRankingSchema);
