const express = require('express');

const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');
const { requireModulePermission, requireAnyModulePermission } = require('../middleware/permission.middleware');

const {
  getCompanyBrandTaskTypes,
  getTaskTypesForCompany,
  upsertCompanyBrandTaskTypes
} = require('../Controller/companyBrandTaskType.controller');

router.use(authMiddleware);

router.get('/', requireAnyModulePermission(['company_brand_task_type', 'create_task', 'assign_task']), getCompanyBrandTaskTypes);
router.get('/company-task-types', requireAnyModulePermission(['company_brand_task_type', 'create_task', 'assign_task']), getTaskTypesForCompany);
router.post('/', requireModulePermission('company_brand_task_type'), upsertCompanyBrandTaskTypes);

module.exports = router;
