const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdminOrManager, requireRoles } = require('../middleware/role.middleware');
const {
  getCompanies,
  createCompany,
  bulkUpsertCompanies,
  deleteCompany
} = require('../Controller/company.controller');

router.use(authMiddleware);

router.get('/', getCompanies);
router.post('/', requireRoles('admin'), createCompany);
router.post('/bulk', requireRoles('admin'), bulkUpsertCompanies);
router.delete('/:id', requireRoles('admin'), deleteCompany);

module.exports = router;
