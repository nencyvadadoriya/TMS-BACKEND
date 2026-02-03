const mongoose = require('mongoose');

const Brand = require('../model/Brand.model');
const TaskType = require('../model/TaskType.model');
const CompanyBrandTaskType = require('../model/CompanyBrandTaskType.model');

const normalizeText = (v) => (v || '').toString().trim();

const escapeRegex = (value) => {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const companyNameToLooseRegex = (value) => {
  const compact = normalizeText(value).replace(/\s+/g, '');
  if (!compact) return null;
  const parts = compact.split('').map((ch) => escapeRegex(ch));
  return new RegExp(`^${parts.join('\\s*')}$`, 'i');
};

const resolveBrandIdFromRequest = async ({ brandId, brandName, companyName }) => {
  const rawBrandId = (brandId || '').toString().trim();
  if (rawBrandId && mongoose.Types.ObjectId.isValid(rawBrandId)) return rawBrandId;

  const name = normalizeText(brandName);
  const company = normalizeText(companyName);
  if (!name) return '';

  const safeName = escapeRegex(name);
  const query = company
    ? {
        name: { $regex: `^${safeName}$`, $options: 'i' },
        company: { $regex: `^${escapeRegex(company)}$`, $options: 'i' }
      }
    : { name: { $regex: `^${safeName}$`, $options: 'i' } };

  const brand = await Brand.findOne(query).select('_id name company').lean();
  return brand?._id ? brand._id.toString() : '';
};

const formatMapping = async (doc) => {
  const mapped = doc ? { ...doc, id: doc._id } : null;
  const ids = Array.isArray(mapped?.taskTypeIds) ? mapped.taskTypeIds.map((id) => id.toString()) : [];

  const taskTypes = ids.length
    ? await TaskType.find({ _id: { $in: ids } }).sort({ name: 1 }).lean()
    : [];

  return {
    id: mapped?._id || '',
    companyName: (mapped?.companyName || '').toString(),
    brandId: mapped?.brandId ? mapped.brandId.toString() : '',
    brandName: (mapped?.brandName || '').toString(),
    taskTypes: (taskTypes || []).map((t) => ({
      id: t._id,
      name: (t.name || '').toString()
    }))
  };
};

exports.getCompanyBrandTaskTypes = async (req, res) => {
  try {
    const companyName = normalizeText(req.query?.companyName);
    const brandName = normalizeText(req.query?.brandName);
    const brandId = await resolveBrandIdFromRequest({
      brandId: req.query?.brandId,
      brandName,
      companyName
    });

    if (!brandId) {
      return res.status(200).json({ success: true, data: null });
    }

    const doc = await CompanyBrandTaskType.findOne({ brandId }).lean();
    if (!doc) {
      return res.status(200).json({
        success: true,
        data: {
          id: '',
          companyName,
          brandId,
          brandName,
          taskTypes: []
        }
      });
    }

    const formatted = await formatMapping(doc);
    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error fetching company-brand task types:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch company-brand task types' });
  }
};

exports.getTaskTypesForCompany = async (req, res) => {
  try {
    const companyName = normalizeText(req.query?.companyName);
    if (!companyName) {
      return res.status(200).json({ success: true, data: { companyName: '', taskTypes: [] } });
    }

    const companyRx = companyNameToLooseRegex(companyName);
    const companyQuery = companyRx
      ? { $regex: companyRx }
      : { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' };

    const docs = await CompanyBrandTaskType.find({
      companyName: companyQuery
    })
      .select('taskTypeIds')
      .lean();

    const taskTypeIds = Array.from(
      new Set(
        (docs || [])
          .flatMap((d) => (Array.isArray(d.taskTypeIds) ? d.taskTypeIds : []))
          .map((id) => id.toString())
          .filter(Boolean)
      )
    );

    const taskTypes = taskTypeIds.length
      ? await TaskType.find({ _id: { $in: taskTypeIds } }).sort({ name: 1 }).lean()
      : [];

    return res.status(200).json({
      success: true,
      data: {
        companyName,
        taskTypes: (taskTypes || []).map((t) => ({
          id: t._id,
          name: (t.name || '').toString()
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching task types for company:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch company task types' });
  }
};

exports.upsertCompanyBrandTaskTypes = async (req, res) => {
  try {
    const companyName = normalizeText(req.body?.companyName);
    const brandName = normalizeText(req.body?.brandName);
    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const brandId = await resolveBrandIdFromRequest({
      brandId: req.body?.brandId,
      brandName,
      companyName
    });

    if (!brandId) {
      return res.status(400).json({ success: false, message: 'Valid brand is required' });
    }

    const rawTaskTypeIds = Array.isArray(req.body?.taskTypeIds) ? req.body.taskTypeIds : [];
    const taskTypeIds = rawTaskTypeIds
      .map((v) => {
        if (!v) return '';
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'object') return String(v._id || v.id || '').trim();
        return '';
      })
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    const update = {
      companyName,
      brandId,
      brandName,
      taskTypeIds,
      updatedBy: actorId
    };

    const doc = await CompanyBrandTaskType.findOneAndUpdate(
      { brandId },
      { $set: update, $setOnInsert: { createdBy: actorId } },
      { new: true, upsert: true }
    ).lean();

    const formatted = await formatMapping(doc);
    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error upserting company-brand task types:', error);
    return res.status(500).json({ success: false, message: 'Failed to save company-brand task types' });
  }
};
