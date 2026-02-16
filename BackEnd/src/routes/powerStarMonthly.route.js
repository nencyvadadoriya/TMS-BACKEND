const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const controller = require('../Controller/powerStarMonthly.controller');

router.get('/', auth, requireRoles('manager'), controller.getMonthly);
router.put('/', auth, requireRoles('manager'), controller.saveMonthly);

module.exports = router;
