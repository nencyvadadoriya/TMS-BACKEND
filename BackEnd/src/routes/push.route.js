const express = require('express');

const { registerDeviceToken, linkDeviceToUser, testPush } = require('../Controller/push.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/register', registerDeviceToken);
router.post('/test', authMiddleware, testPush);
router.post('/link', authMiddleware, linkDeviceToUser);

module.exports = router;
