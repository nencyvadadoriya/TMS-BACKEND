const mongoose = require('mongoose');

const rowSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    churn: {
      type: [Number],
      default: [0, 0, 0, 0]
    },
    liveAssign: {
      type: [Number],
      default: [0, 0, 0, 0]
    },
    hits: {
      type: [Number],
      default: [0, 0, 0, 0]
    }
  },
  { _id: false }
);

const powerStarMonthlySchema = new mongoose.Schema(
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

powerStarMonthlySchema.index({ companyName: 1, monthKey: 1 }, { unique: true });

module.exports = mongoose.model('PowerStarMonthly', powerStarMonthlySchema);
