const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdminOrManager, requireRoles } = require('../middleware/role.middleware');
const { requireModulePermission } = require('../middleware/permission.middleware');
const {
  getCompanies,
  getDeletedCompanies,
  createCompany,
  bulkUpsertCompanies,
  updateCompany,
  deleteCompany,
  getCompanyHistory
} = require('../Controller/company.controller');

router.use(authMiddleware);

router.get('/', getCompanies);
router.get('/admin/deleted', requireModulePermission('brands_companies_report'), getDeletedCompanies);
router.get('/:id/history', requireModulePermission('brands_companies_report'), getCompanyHistory);
router.post('/', requireRoles('admin'), createCompany);
router.post('/bulk', requireModulePermission('company_bulk_add'), bulkUpsertCompanies);
router.put('/:id', requireModulePermission('company_edit'), updateCompany);
router.delete('/:id', requireModulePermission('company_delete'), deleteCompany);

module.exports = router;
