const mongoose = require('mongoose');

const strikeRemovalSchema = new mongoose.Schema({
    remark: {
        type: String,
        required: true,
        trim: true
    },
    removedAt: {
        type: Date,
        default: Date.now
    },
    removedBy: {
        id: { type: String, default: '' },
        name: { type: String, default: '' },
        email: { type: String, default: '', trim: true, lowercase: true },
        role: { type: String, default: '' }
    }
}, {
    _id: false,
    versionKey: false
});

const strikeSchema = new mongoose.Schema({
    taskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task',
        required: true,
        unique: true,
        index: true
    },
    companyKey: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        index: true
    },
    firstOverdueAt: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    isRemoved: {
        type: Boolean,
        default: false,
        index: true
    },
    removalHistory: {
        type: [strikeRemovalSchema],
        default: []
    }
}, {
    timestamps: true,
    versionKey: false
});

strikeSchema.index({ companyKey: 1, isRemoved: 1, firstOverdueAt: -1 });

module.exports = mongoose.model('Strike', strikeSchema);
