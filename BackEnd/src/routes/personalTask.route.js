const express = require('express');

const authMiddleware = require('../middleware/auth.middleware');

const {
  createPersonalTask,
  getMyPersonalTasks,
  updateMyPersonalTask,
  deleteMyPersonalTask
} = require('../Controller/personalTask.controller');

const router = express.Router();

router.post('/', authMiddleware, createPersonalTask);
router.get('/mine', authMiddleware, getMyPersonalTasks);
router.put('/:id', authMiddleware, updateMyPersonalTask);
router.delete('/:id', authMiddleware, deleteMyPersonalTask);

module.exports = router;
