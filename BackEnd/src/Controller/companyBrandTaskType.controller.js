const mongoose = require('mongoose');

const Brand = require('../model/Brand.model');
const TaskType = require('../model/TaskType.model');

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
    return res.status(200).json({ success: true, data: null });
  } catch (error) {
    console.error('Error fetching company-brand task types:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch company-brand task types' });
  }
};

exports.getTaskTypesForCompany = async (req, res) => {
  try {
    return res.status(200).json({ success: true, data: { companyName: '', taskTypes: [] } });
  } catch (error) {
    console.error('Error fetching task types for company:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch company task types' });
  }
};

exports.upsertCompanyBrandTaskTypes = async (req, res) => {
  try {
    return res.status(501).json({ success: false, message: 'Company-brand task type mapping is not supported' });
  } catch (error) {
    console.error('Error upserting company-brand task types:', error);
    return res.status(500).json({ success: false, message: 'Failed to save company-brand task types' });
  }
};
