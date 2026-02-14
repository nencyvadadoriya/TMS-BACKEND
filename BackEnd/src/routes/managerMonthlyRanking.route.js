const express = require('express');

const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const {
  getManagerMonthlyRanking,
  upsertManagerMonthlyRanking
} = require('../Controller/managerMonthlyRanking.controller');

router.use(authMiddleware);

router.get('/', requireRoles('manager'), getManagerMonthlyRanking);
router.put('/', requireRoles('md_manager'), upsertManagerMonthlyRanking);

module.exports = router;
