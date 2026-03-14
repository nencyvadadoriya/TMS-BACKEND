const express = require("express");
const {
    addTask,
    getAllTasks,
    getSingleTask,
    updateTask,
    mdImpexReassignTask,
    deleteTask,
    addTaskComment,
    getTaskComments,
    getTaskHistory,
    addTaskHistory,
    deleteTaskComment,
    inviteToTask,
    syncTaskToGoogle,
    approveTask,
    getTaskReviews,
    submitTaskReview,
} = require("../../Controller/task.controller");
const authMiddleware = require("../../middleware/auth.middleware");
const { requireAdminOrManager, requireRoles } = require("../../middleware/role.middleware");
const { requireModulePermission } = require("../../middleware/permission.middleware");
const Task = require("../../model/Task.model");

const normalizeEmail = (email) => (email || '').toString().trim().toLowerCase();

const allowDeleteTaskCreatorOrPermission = async (req, res, next) => {
    try {
        const role = String(req.user?.role || '').toLowerCase();
        if (role === 'admin' || role === 'super_admin') return next();

        const userEmail = normalizeEmail(req.user?.email);
        const taskId = String(req.params?.id || '').trim();

        if (userEmail && taskId) {
            const task = await Task.findById(taskId).select('assignedBy').lean();
            if (task && normalizeEmail(task.assignedBy) === userEmail) {
                return next();
            }
        }

        return requireModulePermission('delete_task')(req, res, next);
    } catch {
        return requireModulePermission('delete_task')(req, res, next);
    }
};

const router = express.Router();
router.post("/addTask", authMiddleware, requireRoles('admin', 'manager', 'ob_manager', 'assistant', 'sbm', 'rm', 'am', 'ar', 'troubleshoot_manager', 'sales_manager', 'sales_man'), requireModulePermission('create_task'), addTask);
router.get("/getAllTasks", authMiddleware, getAllTasks);
router.get("/singleTask/:id", authMiddleware, getSingleTask);
router.put("/updateTask/:id", authMiddleware, updateTask);
router.put('/md-impex/reassign/:id', authMiddleware, requireRoles('assistant', 'ob_manager', 'admin', 'super_admin'), mdImpexReassignTask);
router.delete("/deleteTask/:id", authMiddleware, allowDeleteTaskCreatorOrPermission, deleteTask);
router.put('/tasks/:id/approve', authMiddleware, approveTask)

// Task reviews
router.get('/reviews', authMiddleware, getTaskReviews);
router.post('/:id/review', authMiddleware, submitTaskReview);

// Task comments routes
router.post('/:taskId/comments', authMiddleware, addTaskComment);
router.get('/:taskId/comments', authMiddleware, getTaskComments);
router.post('/:taskId/history', authMiddleware, addTaskHistory);
router.get('/:taskId/history', authMiddleware, getTaskHistory);
router.delete('/:taskId/comments/:commentId', authMiddleware, deleteTaskComment);
router.post('/:taskId/sync-google', authMiddleware, syncTaskToGoogle);
router.post('/:taskId/invite', authMiddleware, inviteToTask);

module.exports = router; 
