const cron = require('node-cron');
const PersonalTask = require('../model/PersonalTask.model');
const User = require('../model/user.model');
const { getIO } = require('../realtime/socket');
const { sendTaskReminderPush } = require('../utils/pushNotifications.util');

// Track last reminded tasks to avoid duplicate notifications
const lastRemindedTasks = new Map();

/**
 * Check and trigger personal task reminders
 * Runs every minute to check for due reminders
 */
async function checkPersonalTaskReminders() {
  try {
    const now = new Date();
    const allPending = await PersonalTask.find({ 
      status: { $ne: 'completed' }, 
      reminderStyle: { $ne: 'none' } 
    }).lean();
    
    // Add heartbeat log with pending count
    if (now.getSeconds() === 0) {
      console.log(`[PersonalReminder] Heartbeat. All pending reminders count: ${allPending.length}`);
    }

    const currentMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
    const nextMinute = new Date(currentMinute.getTime() + 60000);

    // Filter tasks locally to log details about why tasks are or aren't matching
    const allTasks = allPending.filter(task => {
      if (!task.reminderAt) return false;
      const target = new Date(task.reminderAt);
      
      // Log for all tasks to see what we're comparing
      if (now.getSeconds() === 0) {
        console.log(`[PersonalReminder] Checking task: "${task.title}" | style: ${task.reminderStyle} | target: ${target.toISOString()} | now: ${now.toISOString()}`);
      }

      if (task.reminderStyle === 'once') {
         const isDue = target >= currentMinute && target < nextMinute;
         return isDue;
      }
      
      if (task.reminderStyle === 'daily') {
         return target.getHours() === now.getHours() && target.getMinutes() === now.getMinutes();
      }

      if (task.reminderStyle === 'weekly') {
         return target.getDay() === now.getDay() && target.getHours() === now.getHours() && target.getMinutes() === now.getMinutes();
      }

      return false;
    });

    for (const task of allTasks) {
      const cacheKey = `${task._id}_${currentMinute.getTime()}`;
      
      // Skip if already reminded this minute
      if (lastRemindedTasks.has(cacheKey)) {
        continue;
      }

      // Check if it's time to remind for daily/weekly tasks
      if (task.reminderStyle === 'daily' && task.reminderAt) {
        const reminderTime = new Date(task.reminderAt);
        const currentTime = new Date();
        if (reminderTime.getHours() !== currentTime.getHours() || 
            reminderTime.getMinutes() !== currentTime.getMinutes()) {
          continue;
        }
      }

      if (task.reminderStyle === 'weekly' && task.reminderAt) {
        const reminderTime = new Date(task.reminderAt);
        const currentTime = new Date();
        if (currentTime.getDay() !== reminderTime.getDay() ||
            reminderTime.getHours() !== currentTime.getHours() || 
            reminderTime.getMinutes() !== currentTime.getMinutes()) {
          continue;
        }
      }

      // Get user info
      const user = await User.findOne({ email: task.creatorEmail }).select('_id email name').lean();
      if (!user) continue;

      // Create reminder payload
      const reminder = {
        id: `personal_${task._id}_${Date.now()}`,
        taskId: String(task._id),
        title: task.title,
        purpose: task.purpose,
        priority: task.priority,
        fromEmail: 'system',
        fromName: 'Personal Task Reminder',
        message: `Reminder: ${task.title}`,
        createdAt: new Date(),
        task: {
          title: task.title,
          dueDate: task.reminderAt,
          status: task.status,
          purpose: task.purpose,
          priority: task.priority
        }
      };

      // Send socket event to user
      try {
        const io = getIO();
        io.to(`user:${String(user._id)}`).emit('personal:reminder', { reminder });
        console.log(`[PersonalReminder] Sent to user:${String(user._id)} for task ${task.title}`);
      } catch (e) {
        console.error('[PersonalReminder] Socket error:', e);
      }

      // Send push notification
      try {
        await sendTaskReminderPush({
          toEmail: task.creatorEmail,
          task: {
            title: task.title,
            dueDate: task.reminderAt,
            status: task.status
          },
          fromName: 'Personal Task Reminder',
          reminderMessage: `Don't forget: ${task.title}`
        });
      } catch (e) {
        console.error('[PersonalReminder] Push error:', e);
      }

      // Mark as reminded (store current wall-clock time for cleanup)
      lastRemindedTasks.set(cacheKey, Date.now());
      
      // Clean up old cache entries (keep only last hour)
      const oneHourAgo = Date.now() - 3600000;
      for (const [key, insertedAt] of lastRemindedTasks.entries()) {
        if (insertedAt < oneHourAgo) {
          lastRemindedTasks.delete(key);
        }
      }
    }
  } catch (error) {
    console.error('[PersonalReminder] Error checking reminders:', error);
  }
}

/**
 * Start the personal task reminder scheduler
 */
function startPersonalTaskReminderScheduler() {
  // Run every minute
  cron.schedule('* * * * *', checkPersonalTaskReminders);
  console.log('[PersonalReminder] Scheduler started - checking every minute');
}

module.exports = {
  startPersonalTaskReminderScheduler,
  checkPersonalTaskReminders
};
