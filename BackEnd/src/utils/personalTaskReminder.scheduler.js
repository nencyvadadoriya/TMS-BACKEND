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
    const currentMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
    const nextMinute = new Date(currentMinute.getTime() + 60000);

    // Find tasks with 'once' reminder style where reminderAt is within this minute
    const onceTasks = await PersonalTask.find({
      reminderStyle: 'once',
      reminderAt: {
        $gte: currentMinute,
        $lt: nextMinute
      },
      status: { $ne: 'completed' }
    }).lean();

    // Find tasks with recurring reminders (daily/weekly) that haven't been reminded today
    const dailyTasks = await PersonalTask.find({
      reminderStyle: 'daily',
      status: { $ne: 'completed' }
    }).lean();

    const weeklyTasks = await PersonalTask.find({
      reminderStyle: 'weekly',
      status: { $ne: 'completed' }
    }).lean();

    const allTasks = [...onceTasks, ...dailyTasks, ...weeklyTasks];

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

      // Mark as reminded
      lastRemindedTasks.set(cacheKey, true);
      
      // Clean up old cache entries (keep only last hour)
      const oneHourAgo = Date.now() - 3600000;
      for (const [key, value] of lastRemindedTasks.entries()) {
        const keyTime = parseInt(key.split('_')[1]);
        if (keyTime < oneHourAgo) {
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
