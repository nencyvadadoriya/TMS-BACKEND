const mongoose = require('mongoose');
const Company = require('../model/Company.model');
const Brand = require('../model/Brand.model');
const User = require('../model/user.model');
const TaskType = require('../model/TaskType.model');

const normalizeName = (v) => (v || '').toString().trim();
const normalizeText = (v) => (v || '').toString().trim();

const normalizeTaskTypeNameCanonical = (value) => {
  const raw = normalizeText(value);
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[\s-]+/g, ' ').trim();
  if (key === 'troubleshoot' || key === 'trouble shoot' || key === 'trubbleshot' || key === 'trubble shoot') {
    return 'Troubleshoot';
  }
  return raw;
};

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

const resolveBrandIdFromRequest = async ({ brandId, brandName, companyId }) => {
  const rawBrandId = (brandId || '').toString().trim();
  if (rawBrandId && mongoose.Types.ObjectId.isValid(rawBrandId)) return rawBrandId;

  const name = normalizeText(brandName);
  if (!name) return null;

  const query = {
    name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
    isDeleted: { $ne: true }
  };
  if (companyId) query.company = companyId;

  const brand = await Brand.findOne(query).select('_id').lean();
  return brand?._id ? brand._id.toString() : null;
};

const resolveUserIdFromRequest = async ({ userId, email }) => {
  const rawUserId = (userId || '').toString().trim();
  if (rawUserId && mongoose.Types.ObjectId.isValid(rawUserId)) return rawUserId;

  const userEmail = normalizeText(email).toLowerCase();
  if (!userEmail) return null;

  const user = await User.findOne({
    email: { $regex: `^${escapeRegex(userEmail)}$`, $options: 'i' },
    isDeleted: { $ne: true }
  })
    .select('_id')
    .lean();

  return user?._id ? user._id.toString() : null;
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

    const brandId = await resolveBrandIdFromRequest({
      brandId: req.query?.brandId,
      brandName: req.query?.brandName,
      companyId
    });

    const userId = await resolveUserIdFromRequest({
      userId: req.query?.userId,
      email: req.query?.email
    });

    const query = {};
    if (companyId) query.companyId = companyId;
    if (brandId) query.brandId = brandId;
    if (userId) query.userId = userId;

    const types = await TaskType.find(query).sort({ name: 1 }).lean();
    res.status(200).json({ success: true, data: types.map(t => formatTaskType(t)) });
  } catch (error) {
    console.error('Error fetching task types:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch task types' });
  }
};

exports.createTaskType = async (req, res) => {
  try {
    const name = normalizeTaskTypeNameCanonical(normalizeName(req.body?.name));
    if (!name) {
      return res.status(400).json({ success: false, message: 'Task type name is required' });
    }

    const companyId = await resolveCompanyIdFromRequest({
      companyId: req.body?.companyId,
      companyName: req.body?.companyName
    });

    const brandId = await resolveBrandIdFromRequest({
      brandId: req.body?.brandId,
      brandName: req.body?.brandName,
      companyId
    });

    const userId = await resolveUserIdFromRequest({
      userId: req.body?.userId,
      email: req.body?.email
    });

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const query = { name, companyId: companyId || null, brandId: brandId || null, userId: userId || null };
    const existing = await TaskType.findOne(query);
    if (existing) {
      return res.status(200).json({ success: true, data: formatTaskType(existing.toObject()) });
    }

    const created = await TaskType.create({
      ...query,
      createdBy: actorId,
      updatedBy: actorId
    });

    res.status(201).json({ success: true, data: formatTaskType(created.toObject()) });
  } catch (error) {
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

    const brandId = await resolveBrandIdFromRequest({
      brandId: req.body?.brandId,
      brandName: req.body?.brandName,
      companyId
    });

    const userId = await resolveUserIdFromRequest({
      userId: req.body?.userId,
      email: req.body?.email
    });

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const results = [];

    for (const raw of items) {
      const name = normalizeName(raw?.name || raw);
      if (!name) continue;

      const query = { name, companyId: companyId || null, brandId: brandId || null, userId: userId || null };
      const doc = await TaskType.findOneAndUpdate(
        query,
        { $set: { ...query, updatedBy: actorId }, $setOnInsert: { createdBy: actorId } },
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
