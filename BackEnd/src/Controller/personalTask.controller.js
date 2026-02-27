const mongoose = require('mongoose');

const PersonalTask = require('../model/PersonalTask.model');

const normalizeText = (v) => (v == null ? '' : String(v)).trim();
const normalizeEmail = (v) => normalizeText(v).toLowerCase();

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

exports.updateMyPersonalTask = async (req, res) => {
  try {
    const creatorEmail = normalizeEmail(req.user?.email);
    if (!creatorEmail) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const id = normalizeText(req.params?.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }

    const update = {};

    if (typeof req.body?.title !== 'undefined') {
      const title = normalizeText(req.body?.title);
      if (!title) return res.status(400).json({ success: false, message: 'Task title is required' });
      update.title = title;
    }

    if (typeof req.body?.purpose !== 'undefined') {
      update.purpose = normalizeText(req.body?.purpose);
    }

    if (typeof req.body?.priority !== 'undefined') {
      const priority = normalizeText(req.body?.priority).toLowerCase();
      const allowedPriorities = new Set(['high', 'medium', 'low']);
      if (!allowedPriorities.has(priority)) {
        return res.status(400).json({ success: false, message: 'Invalid priority' });
      }
      update.priority = priority;
    }

    if (typeof req.body?.status !== 'undefined') {
      const status = normalizeText(req.body?.status).toLowerCase();
      const allowedStatuses = new Set(['pending', 'in-progress', 'completed']);
      if (!allowedStatuses.has(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
      }
      update.status = status;
    }

    if (typeof req.body?.reminderStyle !== 'undefined') {
      const reminderStyle = normalizeText(req.body?.reminderStyle).toLowerCase();
      const allowedReminderStyles = new Set(['none', 'once', 'daily', 'weekly']);
      if (!allowedReminderStyles.has(reminderStyle)) {
        return res.status(400).json({ success: false, message: 'Invalid reminder style' });
      }
      update.reminderStyle = reminderStyle;
    }

    if (typeof req.body?.reminderAt !== 'undefined') {
      if (!req.body?.reminderAt) {
        update.reminderAt = null;
      } else {
        const candidate = new Date(req.body.reminderAt);
        if (Number.isNaN(candidate.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid reminder date/time' });
        }
        update.reminderAt = candidate;
      }
    }

    const next = await PersonalTask.findOneAndUpdate(
      { _id: id, creatorEmail },
      { $set: update },
      { new: true }
    ).lean();

    if (!next) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Personal task updated',
      data: { ...next, id: String(next._id) }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Failed to update personal task' });
  }
};

exports.deleteMyPersonalTask = async (req, res) => {
  try {
    const creatorEmail = normalizeEmail(req.user?.email);
    if (!creatorEmail) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const id = normalizeText(req.params?.id);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }

    const deleted = await PersonalTask.findOneAndDelete({ _id: id, creatorEmail }).lean();
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Personal task not found' });
    }

    return res.status(200).json({ success: true, message: 'Personal task deleted', data: { id } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Failed to delete personal task' });
  }
};

exports.createPersonalTask = async (req, res) => {
  try {
    const creatorEmail = normalizeEmail(req.user?.email);
    if (!creatorEmail) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const title = normalizeText(req.body?.title);
    if (!title) {
      return res.status(400).json({ success: false, message: 'Task title is required' });
    }

    const purpose = normalizeText(req.body?.purpose);
    const priority = normalizeText(req.body?.priority).toLowerCase() || 'medium';
    const reminderStyle = normalizeText(req.body?.reminderStyle).toLowerCase() || 'none';
    const status = normalizeText(req.body?.status).toLowerCase() || 'pending';

    const allowedPriorities = new Set(['high', 'medium', 'low']);
    if (!allowedPriorities.has(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid priority' });
    }

    const allowedReminderStyles = new Set(['none', 'once', 'daily', 'weekly']);
    if (!allowedReminderStyles.has(reminderStyle)) {
      return res.status(400).json({ success: false, message: 'Invalid reminder style' });
    }

    const allowedStatuses = new Set(['pending', 'in-progress', 'completed']);
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    let reminderAt = null;
    if (req.body?.reminderAt) {
      const candidate = new Date(req.body.reminderAt);
      if (Number.isNaN(candidate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid reminder date/time' });
      }
      reminderAt = candidate;
    }

    if (reminderStyle === 'once' && !reminderAt) {
      return res.status(400).json({ success: false, message: 'reminderAt is required for once reminders' });
    }

    const companyName = normalizeText(req.body?.companyName || req.user?.companyName || req.user?.company);

    const creatorUserId = safeObjectId(req.user?.id || req.user?._id || req.user?.userId);

    const created = await PersonalTask.create({
      title,
      status,
      purpose,
      priority,
      reminderStyle,
      reminderAt,
      companyName,
      creatorEmail,
      creatorUserId
    });

    return res.status(201).json({
      success: true,
      message: 'Personal task created',
      data: {
        ...created.toObject(),
        id: created._id
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Failed to create personal task' });
  }
};

exports.getMyPersonalTasks = async (req, res) => {
  try {
    const creatorEmail = normalizeEmail(req.user?.email);
    if (!creatorEmail) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50)));

    const docs = await PersonalTask.find({ creatorEmail })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const data = (docs || []).map((d) => ({
      ...d,
      id: d?._id ? String(d._id) : ''
    }));

    return res.status(200).json({ success: true, message: 'Personal tasks fetched', data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e?.message || 'Failed to fetch personal tasks' });
  }
};
