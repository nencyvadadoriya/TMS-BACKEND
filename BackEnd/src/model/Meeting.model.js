const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
    meetingName: {
        type: String,
        required: true,
        trim: true
    },
    startTime: {
        type: Date,
        required: true
    },
    endTime: {
        type: Date,
        required: true
    },
    duration: {
        type: Number, // in minutes
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    description: {
        type: String,
        trim: true
    },
    isZoomMeeting: {
        type: Boolean,
        default: false
    },
    zoomMeetingId: {
        type: String
    },
    zoomJoinUrl: {
        type: String
    },
    zoomPassword: {
        type: String
    },
    status: {
        type: String,
        enum: ['scheduled', 'completed'],
        default: 'scheduled'
    }
}, { timestamps: true });

module.exports = mongoose.model('Meeting', meetingSchema);
