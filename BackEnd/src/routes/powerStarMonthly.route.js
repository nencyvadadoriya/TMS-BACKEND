const express = require('express');

const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const {
  getPowerStarMonthly,
  upsertPowerStarMonthly
} = require('../Controller/powerStarMonthly.controller');

router.use(authMiddleware);

router.get('/', requireRoles('manager'), getPowerStarMonthly);
router.put('/', requireRoles('md_manager'), upsertPowerStarMonthly);

module.exports = router;
