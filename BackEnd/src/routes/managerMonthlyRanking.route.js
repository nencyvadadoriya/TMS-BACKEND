const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const controller = require('../Controller/managerMonthlyRanking.controller');

router.get('/', auth, requireRoles('manager', 'admin', 'super_admin'), controller.getMonthlyRanking);
router.put('/', auth, requireRoles('manager', 'admin', 'super_admin'), controller.saveMonthlyRanking);

module.exports = router;
