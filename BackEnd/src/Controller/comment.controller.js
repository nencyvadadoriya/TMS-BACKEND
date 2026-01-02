// backend/routes/comments.js
const express = require('express');
const router = express.Router();
const Comment = require('../model/Comment.model');
const Task = require('../model/Task.model');
const auth = require('../middleware/auth.middleware');

//  Add comment to task (PERMANENT STORAGE)
router.post('/tasks/:taskId/comments', auth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;
    
    console.log('Adding comment to task:', taskId);
    console.log('User:', req.user);
    console.log('Content:', content);

    // Check if task exists
    const task = await Task.findById(taskId);
    if (!task) {
      console.error('Task not found:', taskId);
      return res.status(404).json({ error: 'Task not found' });
    }

    // Create comment in database
    const comment = new Comment({
      content,
      taskId,
      userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role
    });

    await comment.save();
    console.log('Comment saved to DB:', comment._id);

    // Update task with comment reference
    await Task.findByIdAndUpdate(taskId, {
      $push: { comments: comment._id }
    });

    res.status(201).json({
      id: comment._id,
      content: comment.content,
      taskId: comment.taskId,
      userId: comment.userId,
      userName: comment.userName,
      userEmail: comment.userEmail,
      userRole: comment.userRole,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt
    });

  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ 
      error: 'Failed to add comment',
      details: error.message 
    });
  }
});

//  Get all comments for a task
router.get('/tasks/:taskId/comments', auth, async (req, res) => {
  try {
    const { taskId } = req.params;
    
    console.log('Fetching comments for task:', taskId);
    
    const comments = await Comment.find({ taskId })
      .sort({ createdAt: -1 })
      .lean();

    console.log(`Found ${comments.length} comments for task ${taskId}`);

    res.json(comments.map(comment => ({
      id: comment._id.toString(),
      content: comment.content,
      taskId: comment.taskId.toString(),
      userId: comment.userId.toString(),
      userName: comment.userName,
      userEmail: comment.userEmail,
      userRole: comment.userRole,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt
    })));

  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ 
      error: 'Failed to fetch comments',
      details: error.message 
    });
  }
});

// Delete comment
router.delete('/tasks/:taskId/comments/:commentId', auth, async (req, res) => {
  try {
    const { taskId, commentId } = req.params;
    const userId = req.user.id;

    console.log('Deleting comment:', commentId, 'from task:', taskId);

    // Find comment
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Check authorization
    if (comment.userId.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }

    // Delete from database
    await Comment.findByIdAndDelete(commentId);

    // Remove from task
    await Task.findByIdAndUpdate(taskId, {
      $pull: { comments: commentId }
    });

    res.json({ message: 'Comment deleted successfully' });

  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ 
      error: 'Failed to delete comment',
      details: error.message 
    });
  }
});

module.exports = router;