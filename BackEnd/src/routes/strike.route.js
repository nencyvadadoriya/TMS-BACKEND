const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const strikeController = require('../Controller/strike.controller');

router.get('/md-impex', auth, requireRoles('manager'), strikeController.getMdImpexStrike);
router.patch('/:id/remove', auth, requireRoles('manager'), strikeController.removeStrike);

module.exports = router;
