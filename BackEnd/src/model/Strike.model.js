const mongoose = require('mongoose');

const StrikeRemovalEntrySchema = new mongoose.Schema(
  {
    remark: { type: String, default: '' },
    removedAt: { type: Date, default: Date.now },
    removedBy: {
      id: { type: String },
      name: { type: String },
      email: { type: String },
      role: { type: String }
    }
  },
  { _id: false }
);

const StrikeSchema = new mongoose.Schema(
  {
    taskId: { type: String, required: true, index: true },
    companyKey: { type: String, default: '', index: true },
    firstOverdueAt: { type: Date, default: null },
    isRemoved: { type: Boolean, default: false },
    removalHistory: { type: [StrikeRemovalEntrySchema], default: [] }
  },
  { timestamps: true }
);

StrikeSchema.index({ taskId: 1, isRemoved: 1 });

module.exports = mongoose.models.Strike || mongoose.model('Strike', StrikeSchema);
