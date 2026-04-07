const mongoose = require('mongoose');
const TaskType = require('../model/TaskType.model');
const Company = require('../model/Company.model');
const redisClient = require('../utils/redisClient');

const clearTaskTypeCache = async () => {
    try {
        if (redisClient && redisClient.status === 'ready') {
            const keys = await redisClient.keys('*:taskTypes');
            if (keys.length > 0) await redisClient.del(keys);
        }
    } catch (e) {
        console.warn('[Redis] TaskType cache clear error:', e.message);
    }
};

const normalizeName = (v) => (v || '').toString().trim();
const normalizeText = (v) => (v || '').toString().trim();

const escapeRegex = (value) => {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const resolveCompanyIdFromRequest = async ({ companyId, companyName }) => {
  const rawCompanyId = (companyId || '').toString().trim();
  if (rawCompanyId && mongoose.Types.ObjectId.isValid(rawCompanyId)) return rawCompanyId;

  const name = normalizeText(companyName);
  if (!name) return null;

  const company = await Company.findOne({
    name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
    isDeleted: { $ne: true }
  })
    .select('_id')
    .lean();

  return company?._id ? company._id.toString() : null;
};

const formatTaskType = (t) => ({
  ...t,
  id: t._id
});

exports.getTaskTypes = async (req, res) => {
  try {
    const companyId = await resolveCompanyIdFromRequest({
      companyId: req.query?.companyId,
      companyName: req.query?.companyName
    });

    const cacheKey = companyId ? `company:${companyId}:taskTypes` : `global:taskTypes`;

    if (redisClient && redisClient.status === 'ready') {
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));
    }

    const query = {};
    if (companyId) query.companyId = companyId;

    const types = await TaskType.find(query).sort({ name: 1 }).lean();
    const responseData = { success: true, data: types.map(t => formatTaskType(t)) };

    if (redisClient && redisClient.status === 'ready') {
      await redisClient.set(cacheKey, JSON.stringify(responseData), 'EX', 86400); // Cache for 24h
    }

    res.status(200).json(responseData);
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

    const companyId = await resolveCompanyIdFromRequest({
      companyId: req.body?.companyId,
      companyName: req.body?.companyName
    });

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const existing = await TaskType.findOne({ name, companyId: companyId || null });
    if (existing) {
      return res.status(200).json({ success: true, data: formatTaskType(existing.toObject()) });
    }

    const created = await TaskType.create({
      companyId: companyId || null,
      name,
      createdBy: actorId,
      updatedBy: actorId
    });

    await clearTaskTypeCache();

    res.status(201).json({ success: true, data: formatTaskType(created.toObject()) });
  } catch (error) {
    if (error?.code === 11000) {
      const companyId = await resolveCompanyIdFromRequest({
        companyId: req.body?.companyId,
        companyName: req.body?.companyName
      });
      const existing = await TaskType.findOne({ name: normalizeName(req.body?.name), companyId: companyId || null });
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

    const companyId = await resolveCompanyIdFromRequest({
      companyId: req.body?.companyId,
      companyName: req.body?.companyName
    });

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const results = [];

    for (const raw of items) {
      const name = normalizeName(raw?.name || raw);
      if (!name) continue;

      const doc = await TaskType.findOneAndUpdate(
        { name, companyId: companyId || null },
        { $set: { name, companyId: companyId || null, updatedBy: actorId }, $setOnInsert: { createdBy: actorId } },
        { new: true, upsert: true }
      );

      results.push({ clientId: raw?.clientId || raw?.id || '', ...formatTaskType(doc.toObject()) });
    }

    await clearTaskTypeCache();

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

    await clearTaskTypeCache();

    res.status(200).json({ success: true, message: 'Task type deleted successfully' });
  } catch (error) {
    console.error('Error deleting task type:', error);
    res.status(500).json({ success: false, message: 'Failed to delete task type' });
  }
};
