const cron = require('node-cron');
const Task = require('../model/Task.model');
const User = require('../model/user.model');
const { getIO } = require('../realtime/socket');

/**
 * Check and mark tasks as overdue for assistant and sub_assistant roles
 * if 24 hours have passed since task creation.
 * Runs every minute to check for overdue tasks.
 */
async function checkAndMarkOverdueTasks() {
  try {
    // Determine current time
    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Find tasks that are not completed, reassigned, or already overdue,
    // and match either the 24‑hour rule or the custom due date rule.
    const overdueTasks = await Task.find({
      status: { $nin: ['completed', 'overdue', 'reassigned'] },
      isDeleted: false,
      $or: [
        { overdueType: '24hours', createdAt: { $lte: cutoff24h } },
        { overdueType: 'custom', dueDate: { $exists: true, $ne: null, $lte: now } }
      ]
    });

    if (overdueTasks.length === 0) {
      return;
    }

    // 4. Update the tasks to 'overdue' status
    const taskIds = overdueTasks.map(t => t._id);
    
    await Task.updateMany(
      { _id: { $in: taskIds } },
      { 
        $set: { 
          status: 'overdue',
          statusUpdatedAt: new Date()
        } 
      }
    );

    console.log(`[OverdueTaskScheduler] Marked ${taskIds.length} tasks as overdue.`);

    // 5. Emit socket events for the updated tasks to notify clients
    try {
      const io = getIO();
      for (const task of overdueTasks) {
        const updatedTask = {
          ...task.toObject(),
          status: 'overdue',
          statusUpdatedAt: new Date()
        };

        // Emit to the assignee
        const assignee = await User.findOne({ email: task.assignedTo }).select('_id').lean();
        if (assignee) {
          io.to(`user:${String(assignee._id)}`).emit('task:upserted', {
            type: 'task:upserted',
            taskId: String(task._id),
            task: updatedTask
          });
        }

        // Emit to the assigner
        const assigner = await User.findOne({ email: task.assignedBy }).select('_id').lean();
        if (assigner) {
          io.to(`user:${String(assigner._id)}`).emit('task:upserted', {
            type: 'task:upserted',
            taskId: String(task._id),
            task: updatedTask
          });
        }

        // Emit to the company room
        if (task.companyName) {
          const companyKey = task.companyName.toLowerCase().replace(/\s+/g, '-');
          io.to(`company:${companyKey}`).emit('task:upserted', {
            type: 'task:upserted',
            taskId: String(task._id),
            task: updatedTask
          });
        }
      }
    } catch (socketError) {
      console.error('[OverdueTaskScheduler] Socket emission error:', socketError);
    }

  } catch (error) {
    console.error('[OverdueTaskScheduler] Error checking overdue tasks:', error);
  }
}

/**
 * Start the overdue task scheduler
 */
function startOverdueTaskScheduler() {
  // Run every minute
  cron.schedule('* * * * *', checkAndMarkOverdueTasks);
  console.log('[OverdueTaskScheduler] Scheduler started - checking for overdue tasks every minute');
}

module.exports = {
  startOverdueTaskScheduler,
  checkAndMarkOverdueTasks
};
