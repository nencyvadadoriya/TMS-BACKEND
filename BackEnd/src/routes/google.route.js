const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const googleController = require('../Controller/google.controller');

const router = express.Router();

router.get('/auth-url', authMiddleware, googleController.getAuthUrl);
router.get('/callback', googleController.callback);
router.get('/status', authMiddleware, googleController.status);
router.post('/disconnect', authMiddleware, googleController.disconnect);
router.post('/sync-tasks-now', authMiddleware, googleController.syncTasksNow);

module.exports = router;
