const mongoose = require('mongoose');
const TaskType = require('../model/TaskType.model');

const normalizeName = (v) => (v || '').toString().trim();

const formatTaskType = (t) => ({
  ...t,
  id: t._id
});

exports.getTaskTypes = async (req, res) => {
  try {
    const types = await TaskType.find({}).sort({ name: 1 }).lean();
    res.status(200).json({ success: true, data: types.map(t => formatTaskType(t)) });
  } catch (error) {
    console.error('Error fetching task types:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch task types' });
  }
};

exports.createTaskType = async (req, res) => {
  try {
    const name = normalizeName(req.body?.name);
    if (!name) {
      return res.status(400).json({ success: false, message: 'Task type name is required' });
    }

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const existing = await TaskType.findOne({ name });
    if (existing) {
      return res.status(200).json({ success: true, data: formatTaskType(existing.toObject()) });
    }

    const created = await TaskType.create({
      name,
      createdBy: actorId,
      updatedBy: actorId
    });

    res.status(201).json({ success: true, data: formatTaskType(created.toObject()) });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await TaskType.findOne({ name: normalizeName(req.body?.name) });
      if (existing) {
        return res.status(200).json({ success: true, data: formatTaskType(existing.toObject()) });
      }
    }

    console.error('Error creating task type:', error);
    res.status(500).json({ success: false, message: 'Failed to create task type' });
  }
};

exports.bulkUpsertTaskTypes = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.types) ? req.body.types : [];
    if (!items.length) {
      return res.status(400).json({ success: false, message: 'types array is required' });
    }

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const results = [];

    for (const raw of items) {
      const name = normalizeName(raw?.name || raw);
      if (!name) continue;

      const doc = await TaskType.findOneAndUpdate(
        { name },
        { $set: { name, updatedBy: actorId }, $setOnInsert: { createdBy: actorId } },
        { new: true, upsert: true }
      );

      results.push({ clientId: raw?.clientId || raw?.id || '', ...formatTaskType(doc.toObject()) });
    }

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error('Error bulk upserting task types:', error);
    res.status(500).json({ success: false, message: 'Failed to bulk upsert task types' });
  }
};

exports.deleteTaskType = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid type id' });
    }

    const deleted = await TaskType.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Task type not found' });
    }

    res.status(200).json({ success: true, message: 'Task type deleted successfully' });
  } catch (error) {
    console.error('Error deleting task type:', error);
    res.status(500).json({ success: false, message: 'Failed to delete task type' });
  }
};
