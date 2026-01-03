const express = require("express");
const {
    addTask,
    getAllTasks,
    getSingleTask,
    updateTask,
    deleteTask,
    addTaskComment,
    getTaskComments,
    getTaskHistory,
    addTaskHistory,
    deleteTaskComment,
    inviteToTask,
    syncTaskToGoogle,
    approveTask,
} =  require("../../Controller/task.controller");
const authMiddleware = require("../../middleware/auth.middleware");
 const { requireAdminOrManager, requireRoles } = require("../../middleware/role.middleware");


const router = express.Router();
router.post("/addTask", authMiddleware, requireRoles('admin', 'manager', 'assistant'), addTask);
router.get("/getAllTasks", authMiddleware, getAllTasks);
router.get("/singleTask/:id", authMiddleware, getSingleTask);
router.put("/updateTask/:id", authMiddleware, updateTask);
router.delete("/deleteTask/:id", authMiddleware, deleteTask);
router.put('/tasks/:id/approve', authMiddleware, approveTask) 

// Task comments routes
router.post('/:taskId/comments', authMiddleware, addTaskComment);
router.get('/:taskId/comments', authMiddleware, getTaskComments);
router.post('/:taskId/history', authMiddleware, addTaskHistory);
router.get('/:taskId/history', authMiddleware, getTaskHistory);
router.delete('/:taskId/comments/:commentId', authMiddleware, deleteTaskComment);
router.post('/:taskId/sync-google', authMiddleware, syncTaskToGoogle);
router.post('/:taskId/invite', authMiddleware, inviteToTask);

module.exports = router; 
