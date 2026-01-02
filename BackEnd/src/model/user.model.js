const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        trim: true
    },

    email: {
        type: String,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
    },
    role: {
        type: String,
        enum: ['user', 'assistant', 'admin', 'manager'],
        default: 'user'
    },
    managerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    assignedBrandIds: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'Brand',
        default: []
    },
    googleOAuth: {
        refreshToken: {
            type: String,
            default: null
        },
        scope: {
            type: [String],
            default: []
        },
        tasksLastPulledAt: {
            type: Date,
            default: null
        },
        connectedAt: {
            type: Date,
            default: null
        }
    },
    // Timestamps
    isGoogleCalendarConnected: {
        type: Boolean,
        default: false
    },
    // OTP related fields
    resetOtp: {
        type: Number,
        default: null
    },

    otpExpiry: {
        type: Date,
        default: null
    },
    otpAttempts: {
        type: Number,
        default: 0
    },
    otpAttemptsExpiry: {
        type: Date,
        default: null
    },
    
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
     completedApproval: {
        type: Boolean,
        default: false
    }
});

module.exports = mongoose.model('User', userSchema);