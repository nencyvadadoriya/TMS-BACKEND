const express = require('express');

const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');
const { requireModulePermission, requireAnyModulePermission } = require('../middleware/permission.middleware');

const {
  getCompanyTaskTypes,
  getAllCompanyTaskTypes,
  upsertCompanyTaskTypes
} = require('../Controller/companyTaskType.controller');

router.use(authMiddleware);

router.get('/all', requireAnyModulePermission(['company_task_type', 'create_task', 'assign_task']), getAllCompanyTaskTypes);
router.get('/', requireAnyModulePermission(['company_task_type', 'create_task', 'assign_task']), getCompanyTaskTypes);
router.post('/', requireAnyModulePermission(['company_task_type', 'create_task', 'assign_task']), upsertCompanyTaskTypes);

module.exports = router;
