const express = require('express');

const authMiddleware = require('../middleware/auth.middleware');

const {
  sendReminder,
  getMyReminders,
  markReminderSeen
} = require('../Controller/reminder.controller');

const router = express.Router();

router.post('/send', authMiddleware, sendReminder);
router.get('/my', authMiddleware, getMyReminders);
router.patch('/:id/seen', authMiddleware, markReminderSeen);
router.put('/:id/seen', authMiddleware, markReminderSeen);

module.exports = router;
