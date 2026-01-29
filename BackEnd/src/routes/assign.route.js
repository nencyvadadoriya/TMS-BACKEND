const express = require('express');

const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');
const { requireModulePermission, requireAnyModulePermission } = require('../middleware/permission.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const {
  getCompanyUsers,
  getAssignmentsForUser,
  getAssignmentsForCompany,
  upsertAssignment,
  assignCompaniesToMdManager,
  assignCompaniesToObManager,
  assignCompaniesToSbm
} = require('../Controller/assign.controller');

router.use(authMiddleware);

router.get('/users', requireAnyModulePermission(['assign_page', 'create_task', 'assign_task']), getCompanyUsers);
router.get('/mappings', requireAnyModulePermission(['assign_page', 'create_task', 'assign_task']), getAssignmentsForUser);
router.get('/company-mappings', requireAnyModulePermission(['assign_page', 'create_task', 'assign_task']), getAssignmentsForCompany);
router.post('/mappings', requireAnyModulePermission(['assign_page', 'brand_assign']), upsertAssignment);

router.post('/md-manager-companies', requireRoles('admin'), assignCompaniesToMdManager);
router.post('/ob-manager-companies', requireRoles('admin'), assignCompaniesToObManager);
router.post('/sbm-companies', requireRoles('admin'), assignCompaniesToSbm);

module.exports = router;
