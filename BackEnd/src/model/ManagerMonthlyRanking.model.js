const mongoose = require('mongoose');

const rowSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    assign: {
      type: Number,
      default: 0
    },
    achieved: {
      type: Number,
      default: 0
    }
  },
  { _id: false }
);

const managerMonthlyRankingSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    monthKey: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    rows: {
      type: [rowSchema],
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
  },
  {
    timestamps: true,
    versionKey: false
  }
);

managerMonthlyRankingSchema.index({ companyName: 1, monthKey: 1 }, { unique: true });

module.exports = mongoose.model('ManagerMonthlyRanking', managerMonthlyRankingSchema);
