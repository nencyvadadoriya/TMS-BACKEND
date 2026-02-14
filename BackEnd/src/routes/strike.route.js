const express = require('express');

const authMiddleware = require('../middleware/auth.middleware');
const strikeController = require('../Controller/strike.controller');

const router = express.Router();

router.get('/md-impex', authMiddleware, strikeController.getMdImpexStrike);
router.patch('/:strikeId/remove', authMiddleware, strikeController.removeStrike);

module.exports = router;
