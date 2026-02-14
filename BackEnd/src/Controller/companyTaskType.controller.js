const mongoose = require('mongoose');

const TaskType = require('../model/TaskType.model');
const Company = require('../model/Company.model');

const normalizeText = (v) => (v || '').toString().trim();

const escapeRegex = (value) => {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const resolveCompanyFromName = async (companyName) => {
  const name = normalizeText(companyName);
  if (!name) return null;

  const company = await Company.findOne({
    name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
    isDeleted: { $ne: true }
  })
    .select('_id name')
    .lean();

  if (!company?._id) return null;
  return { id: company._id.toString(), name: (company.name || '').toString() };
};

const formatCompanyTaskTypes = async (company) => {
  if (!company?.id) {
    return {
      id: '',
      companyId: '',
      companyName: '',
      taskTypes: []
    };
  }

  const taskTypes = await TaskType.find({ companyId: company.id })
    .sort({ name: 1 })
    .lean();

  return {
    id: company.id,
    companyId: company.id,
    companyName: company.name,
    taskTypes: (taskTypes || []).map((t) => ({
      id: t._id,
      name: (t.name || '').toString()
    }))
  };
};

exports.getCompanyTaskTypes = async (req, res) => {
  try {
    const companyName = normalizeText(req.query?.companyName);
    if (!companyName) {
      return res.status(200).json({ success: true, data: { companyName: '', taskTypes: [] } });
    }

    const company = await resolveCompanyFromName(companyName);
    if (!company?.id) {
      return res.status(200).json({ success: true, data: { companyName, taskTypes: [] } });
    }

    const formatted = await formatCompanyTaskTypes(company);
    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error fetching company task types:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch company task types' });
  }
};

exports.getAllCompanyTaskTypes = async (req, res) => {
  try {
    const companies = await Company.find({ isDeleted: { $ne: true } })
      .select('_id name')
      .sort({ name: 1 })
      .lean();

    const taskTypes = await TaskType.find({})
      .select('companyId name')
      .sort({ name: 1 })
      .lean();

    const taskTypesByCompany = new Map();
    
    (taskTypes || []).forEach(taskType => {
      const companyId = taskType.companyId ? taskType.companyId.toString() : 'no-company';
      if (!taskTypesByCompany.has(companyId)) {
        taskTypesByCompany.set(companyId, []);
      }
      taskTypesByCompany.get(companyId).push({
        id: taskType._id,
        name: (taskType.name || '').toString()
      });
    });

    const data = (companies || []).map(company => {
      const companyId = company._id.toString();
      return {
        id: companyId,
        companyId: companyId,
        companyName: (company.name || '').toString(),
        taskTypes: taskTypesByCompany.get(companyId) || []
      };
    });

    // Add task types without company if any exist
    if (taskTypesByCompany.has('no-company')) {
      data.push({
        id: 'no-company',
        companyId: '',
        companyName: 'Unassigned',
        taskTypes: taskTypesByCompany.get('no-company')
      });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Error fetching all company task types:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch company task types' });
  }
};

exports.upsertCompanyTaskTypes = async (req, res) => {
  try {
    const companyName = normalizeText(req.body?.companyName);
    if (!companyName) {
      return res.status(400).json({ success: false, message: 'companyName is required' });
    }

    const company = await resolveCompanyFromName(companyName);
    if (!company?.id) {
      return res.status(400).json({ success: false, message: 'Valid company is required' });
    }

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const rawTaskTypeIds = Array.isArray(req.body?.taskTypeIds) ? req.body.taskTypeIds : [];
    const normalizedTaskTypeIds = rawTaskTypeIds
      .map((v) => {
        if (!v) return '';
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'object') return String(v._id || v.id || '').trim();
        return '';
      })
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    const rawTaskTypeNames = Array.isArray(req.body?.taskTypeNames) ? req.body.taskTypeNames : [];
    const normalizedTaskTypeNames = rawTaskTypeNames
      .map((v) => normalizeText(v))
      .filter(Boolean);

    // Create new task types from names
    const createdIds = new Set();
    if (normalizedTaskTypeNames.length > 0) {
      for (const name of normalizedTaskTypeNames) {
        try {
          const doc = await TaskType.findOneAndUpdate(
            { name, companyId: company.id },
            { 
              $set: { name, companyId: company.id, updatedBy: actorId }, 
              $setOnInsert: { createdBy: actorId } 
            },
            { new: true, upsert: true }
          );
          createdIds.add(doc._id.toString());
        } catch (err) {
          // Skip duplicates
          if (err.code !== 11000) {
            throw err;
          }
        }
      }
    }

    // Update existing task types to belong to this company
    if (normalizedTaskTypeIds.length > 0) {
      await TaskType.updateMany(
        { 
          _id: { $in: normalizedTaskTypeIds },
          companyId: { $ne: company.id }
        },
        { 
          $set: { 
            companyId: company.id, 
            updatedBy: actorId 
          }
        }
      );
    }

    const formatted = await formatCompanyTaskTypes(company);
    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error upserting company task types:', error);
    return res.status(500).json({ success: false, message: 'Failed to save company task types' });
  }
};
