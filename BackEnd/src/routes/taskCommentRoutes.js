const express = require('express');
const router = express.Router();
const Task = require('../model/Task.model');
const TaskComment = require('../model/Comment.model');
const authMiddleware = require('../middleware/auth.middleware');

// Add comment to task
router.post('/addComment/:taskId', authMiddleware, async (req, res) => {
    try {
        const { content } = req.body;
        const { taskId } = req.params;

        // Check if task exists
        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({
                success: false,
                msg: 'Task not found'
            });
        }

        // Create comment
        const comment = new TaskComment({
            taskId: taskId,
            content: content,
            userId: req.user.id,
            userName: req.user.name,
            userEmail: req.user.email,
            userRole: req.user.role
        });

        await comment.save();

        // Add comment to task
        task.comments = task.comments || [];
        task.comments.push(comment._id);
        await task.save();

        res.status(201).json({
            success: true,
            data: comment,
            message: 'Comment added successfully'
        });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({
            success: false,
            msg: 'Failed to add comment'
        });
    }
});

// Get comments for a task
router.get('/getComments/:taskId', authMiddleware, async (req, res) => {
    try {
        const { taskId } = req.params;

        const comments = await TaskComment.find({ taskId: taskId })
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: comments,
            message: 'Comments fetched successfully'
        });
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({
            success: false,
            msg: 'Failed to fetch comments'
        });
    }
});

// Delete a comment
router.delete('/deleteComment/:taskId/:commentId', authMiddleware, async (req, res) => {
    try {
        const { taskId, commentId } = req.params;

        // Find comment
        const comment = await TaskComment.findById(commentId);
        if (!comment) {
            return res.status(404).json({
                success: false,
                msg: 'Comment not found'
            });
        }

        // Check permission (user owns comment or is admin)
        if (comment.userId !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                msg: 'Not authorized to delete this comment'
            });
        }

        // Remove comment
        await comment.deleteOne();

        // Remove comment from task
        await Task.findByIdAndUpdate(taskId, {
            $pull: { comments: commentId }
        });

        res.json({
            success: true,
            message: 'Comment deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({
            success: false,
            msg: 'Failed to delete comment'
        });
    }
});

module.exports = router;