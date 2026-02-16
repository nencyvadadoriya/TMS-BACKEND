const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const controller = require('../Controller/managerMonthlyRanking.controller');

router.get('/', auth, requireRoles('manager'), controller.getMonthlyRanking);
router.put('/', auth, requireRoles('manager'), controller.saveMonthlyRanking);

module.exports = router;
