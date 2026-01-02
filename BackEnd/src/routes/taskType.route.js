const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const { requireAdminOrManager } = require('../middleware/role.middleware');
const {
  getTaskTypes,
  createTaskType,
  bulkUpsertTaskTypes,
  deleteTaskType
} = require('../Controller/taskType.controller');

router.use(authMiddleware);

router.get('/', getTaskTypes);
router.post('/', requireAdminOrManager, createTaskType);
router.post('/bulk', requireAdminOrManager, bulkUpsertTaskTypes);
router.delete('/:id', requireAdminOrManager, deleteTaskType);

module.exports = router;
