const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const controller = require('../Controller/powerStarMonthly.controller');

router.get('/', auth, requireRoles('manager', 'admin', 'super_admin'), controller.getMonthly);
router.put('/', auth, requireRoles('manager', 'admin', 'super_admin'), controller.saveMonthly);

module.exports = router;
