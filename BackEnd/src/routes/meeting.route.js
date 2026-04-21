const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const {
    createMeeting,
    getAllMeetings,
    updateMeeting,
    deleteMeeting,
    endMeeting
} = require('../Controller/meeting.controller');

const router = express.Router();

router.post('/', authMiddleware, createMeeting);
router.get('/', authMiddleware, getAllMeetings);
router.put('/:id', authMiddleware, updateMeeting);
router.put('/:id/end', authMiddleware, endMeeting);
router.delete('/:id', authMiddleware, deleteMeeting);

module.exports = router;
