const mongoose = require('mongoose');
const Meeting = require('../model/Meeting.model');

const normalizeText = (v) => (v == null ? '' : String(v)).trim();
const normalizeEmail = (v) => normalizeText(v).toLowerCase();

exports.createMeeting = async (req, res, next) => {
    try {
        const { meetingName, startTime, endTime, participants, description } = req.body;
        const createdByRaw = req.user?.id || req.user?._id;

        if (!createdByRaw || !mongoose.Types.ObjectId.isValid(createdByRaw)) {
            return res.status(401).json({ success: false, message: 'Unauthorized - Invalid User ID' });
        }

        if (!meetingName || !startTime || !endTime) {
            return res.status(400).json({ success: false, message: 'Meeting name, start time, and end time are required' });
        }

        const start = new Date(startTime);
        const end = new Date(endTime);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid start or end time' });
        }

        if (start >= end) {
            return res.status(400).json({ success: false, message: 'Start time must be before end time' });
        }

        const duration = Math.round((end.getTime() - start.getTime()) / (1000 * 60)); // in minutes

        const safeParticipants = (Array.isArray(participants) ? participants : [])
            .filter(id => id && mongoose.Types.ObjectId.isValid(id))
            .map(id => new mongoose.Types.ObjectId(id));

        const meeting = new Meeting({
            meetingName,
            startTime: start,
            endTime: end,
            duration,
            createdBy: new mongoose.Types.ObjectId(createdByRaw),
            participants: safeParticipants,
            description: description || ''
        });

        await meeting.save();

        return res.status(201).json({
            success: true,
            message: 'Meeting scheduled successfully',
            data: meeting
        });
    } catch (error) {
        console.error('Create Meeting Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to schedule meeting',
            details: error.toString()
        });
    }
};

exports.getAllMeetings = async (req, res, next) => {
    try {
        const userRole = req.user?.role?.toLowerCase();
        const userId = req.user?.id || req.user?._id;

        let query = {};
        if (userRole !== 'admin' && userRole !== 'super_admin') {
            // Regular users only see meetings they created or are participating in
            query = {
                $or: [
                    { createdBy: userId },
                    { participants: userId }
                ]
            };
        }

        const meetings = await Meeting.find(query)
            .populate('createdBy', 'name email')
            .populate('participants', 'name email')
            .sort({ startTime: 1 });

        return res.status(200).json({
            success: true,
            message: 'Meetings fetched successfully',
            data: meetings
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch meetings' });
    }
};

exports.updateMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { meetingName, startTime, endTime, participants, description } = req.body;
        const userId = req.user?.id || req.user?._id;
        const userRole = req.user?.role?.toLowerCase();

        const meeting = await Meeting.findById(id);
        if (!meeting) {
            return res.status(404).json({ success: false, message: 'Meeting not found' });
        }

        // Only creator or admin can update
        if (meeting.createdBy.toString() !== userId.toString() && userRole !== 'admin' && userRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized to update this meeting' });
        }

        if (meetingName) meeting.meetingName = meetingName;
        if (startTime) meeting.startTime = new Date(startTime);
        if (endTime) meeting.endTime = new Date(endTime);
        if (participants) meeting.participants = participants;
        if (description !== undefined) meeting.description = description;

        if (startTime || endTime) {
            const start = new Date(meeting.startTime);
            const end = new Date(meeting.endTime);
            if (start >= end) {
                return res.status(400).json({ success: false, message: 'Start time must be before end time' });
            }
            meeting.duration = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
        }

        await meeting.save();

        return res.status(200).json({
            success: true,
            message: 'Meeting updated successfully',
            data: meeting
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to update meeting' });
    }
};

exports.deleteMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id || req.user?._id;
        const userRole = req.user?.role?.toLowerCase();

        const meeting = await Meeting.findById(id);
        if (!meeting) {
            return res.status(404).json({ success: false, message: 'Meeting not found' });
        }

        // Only creator or admin can delete
        if (meeting.createdBy.toString() !== userId.toString() && userRole !== 'admin' && userRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized to delete this meeting' });
        }

        await Meeting.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: 'Meeting deleted successfully'
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Failed to delete meeting' });
    }
};
