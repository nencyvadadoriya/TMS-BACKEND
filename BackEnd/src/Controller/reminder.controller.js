const mongoose = require('mongoose');

const Task = require('../model/Task.model');
const TaskReminder = require('../model/TaskReminder.model');
const User = require('../model/user.model');

const { sendTaskReminderPush } = require('../utils/pushNotifications.util');

const { getIO } = require('../realtime/socket');

const normalizeText = (v) => (v == null ? '' : String(v)).trim();
const normalizeEmail = (v) => normalizeText(v).toLowerCase();

const roleKeyOf = (v) => normalizeText(v).toLowerCase().replace(/[\s-]+/g, '_');

const safeObjectId = (value) => {
  try {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) return value;
    const s = String(value).trim();
    if (!s) return null;
    if (!mongoose.Types.ObjectId.isValid(s)) return null;
    return new mongoose.Types.ObjectId(s);
  } catch {
    return null;
  }
};

exports.sendReminder = async (req, res) => {
  try {
    const taskIdRaw = normalizeText(req.body?.taskId);
    const taskId = safeObjectId(taskIdRaw);
    if (!taskId) {
      return res.status(400).json({ success: false, message: 'taskId is required' });
    }

    const requesterEmail = normalizeEmail(req.user?.email);
    const requesterRole = roleKeyOf(req.user?.role);
    if (!requesterEmail) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const task = await Task.findById(taskId).select('_id title dueDate status companyName brand assignedTo assignedBy isDeleted').lean();
    if (!task || task.isDeleted) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const isAdminLike = requesterRole === 'admin' || requesterRole === 'super_admin';
    const isCreator = normalizeEmail(task.assignedBy) === requesterEmail;

    if (!isAdminLike && !isCreator) {
      return res.status(403).json({ success: false, message: 'You are not allowed to send reminders for this task' });
    }

    const toEmail = normalizeEmail(task.assignedTo);
    if (!toEmail) {
      return res.status(400).json({ success: false, message: 'Task has no assignee' });
    }

    const message = normalizeText(req.body?.message);

    const toUser = await User.findOne({ email: toEmail }).select('_id email').lean();
    const fromUser = await User.findOne({ email: requesterEmail }).select('_id email').lean();

    const reminder = await TaskReminder.create({
      taskId: task._id,
      toEmail,
      toUserId: toUser?._id || null,
      fromEmail: requesterEmail,
      fromUserId: fromUser?._id || null,
      message,
      seen: false,
      seenAt: null,
      taskSnapshot: {
        title: task.title || '',
        dueDate: task.dueDate || null,
        status: task.status || '',
        companyName: task.companyName || '',
        brand: task.brand || '',
      }
    });

    try {
      if (toUser?._id) {
        const io = getIO();
        io.to(`user:${String(toUser._id)}`).emit('reminder:new', { reminder: reminder.toClient() });
      }
    } catch (e) {
      // ignore realtime errors
    }

    try {
      await sendTaskReminderPush({
        toEmail,
        task,
        fromName: normalizeText(req.user?.name) || 'User',
        reminderMessage: message,
      });
    } catch {
      // ignore push errors
    }

    return res.status(201).json({ success: true, data: reminder.toClient(), message: 'Reminder sent' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Failed to send reminder' });
  }
};

exports.getMyReminders = async (req, res) => {
  try {
    const me = normalizeEmail(req.user?.email);
    if (!me) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const limit = Math.min(50, Math.max(1, Number(req.query?.limit || 20)));

    const docs = await TaskReminder.find({
      toEmail: me,
      seen: false,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const data = (docs || []).map((d) => {
      const id = d?._id ? String(d._id) : '';
      return {
        id,
        taskId: d?.taskId ? String(d.taskId) : '',
        toEmail: d?.toEmail,
        fromEmail: d?.fromEmail,
        message: d?.message || '',
        seen: Boolean(d?.seen),
        seenAt: d?.seenAt || null,
        createdAt: d?.createdAt || null,
        task: {
          title: d?.taskSnapshot?.title || '',
          dueDate: d?.taskSnapshot?.dueDate || null,
          status: d?.taskSnapshot?.status || '',
          companyName: d?.taskSnapshot?.companyName || '',
          brand: d?.taskSnapshot?.brand || '',
        }
      };
    });

    return res.status(200).json({ success: true, data, message: 'Reminders fetched' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Failed to fetch reminders' });
  }
};

exports.markReminderSeen = async (req, res) => {
  try {
    const me = normalizeEmail(req.user?.email);
    if (!me) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const reminderId = normalizeText(req.params?.id);
    if (!reminderId || !mongoose.Types.ObjectId.isValid(reminderId)) {
      return res.status(400).json({ success: false, message: 'Invalid reminder id' });
    }

    const updated = await TaskReminder.findOneAndUpdate(
      { _id: reminderId, toEmail: me },
      { $set: { seen: true, seenAt: new Date() } },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Reminder not found' });
    }

    return res.status(200).json({ success: true, data: updated.toClient(), message: 'Reminder acknowledged' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Failed to acknowledge reminder' });
  }
};
