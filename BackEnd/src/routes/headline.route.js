const express = require('express');
const router = express.Router();
const headlineController = require('../Controller/headline.controller');
const auth = require('../middleware/auth.middleware');

router.get('/active', auth, headlineController.getActiveHeadline);
router.post('/create', auth, headlineController.createHeadline);
router.post('/deactivate', auth, headlineController.deactivateHeadline);

module.exports = router;
