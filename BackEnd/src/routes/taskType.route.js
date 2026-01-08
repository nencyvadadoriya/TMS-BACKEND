const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdminOrManager } = require('../middleware/role.middleware');
const { requireModulePermission } = require('../middleware/permission.middleware');
const {
  getTaskTypes,
  createTaskType,
  bulkUpsertTaskTypes,
  deleteTaskType
} = require('../Controller/taskType.controller');

router.use(authMiddleware);

router.get('/', getTaskTypes);
router.post('/', requireAdminOrManager, createTaskType);
router.post('/bulk', requireModulePermission('task_type_bulk_add'), bulkUpsertTaskTypes);
router.delete('/:id', requireAdminOrManager, deleteTaskType);

module.exports = router;
