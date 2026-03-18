const mongoose = require('mongoose');

const TaskType = require('../model/TaskType.model');
const CompanyTaskType = require('../model/CompanyTaskType.model');
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

const formatCompanyTaskTypes = async (doc) => {
  const mapped = doc ? { ...doc, id: doc._id } : null;
  const ids = Array.isArray(mapped?.taskTypeIds) ? mapped.taskTypeIds.map((id) => id.toString()) : [];

  const taskTypes = ids.length
    ? await TaskType.find({ _id: { $in: ids } }).sort({ name: 1 }).lean()
    : [];

  return {
    id: mapped?._id || '',
    companyId: mapped?.companyId ? mapped.companyId.toString() : '',
    companyName: (mapped?.companyName || '').toString(),
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

    const existing = await CompanyTaskType.findOne({ companyId: company.id }).lean();
    if (!existing) {
      const legacy = await CompanyTaskType.findOne({
        companyId: null,
        companyName: { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' }
      }).lean();

      if (!legacy) {
        return res.status(200).json({ success: true, data: { companyName: company.name || companyName, taskTypes: [] } });
      }

      const migrated = await CompanyTaskType.findByIdAndUpdate(
        legacy._id,
        { $set: { companyId: company.id, companyName: company.name || legacy.companyName } },
        { new: true }
      ).lean();

      const formatted = await formatCompanyTaskTypes(migrated);
      return res.status(200).json({ success: true, data: formatted });
    }

    const formatted = await formatCompanyTaskTypes(existing);
    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error fetching company task types:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch company task types' });
  }
};

exports.getAllCompanyTaskTypes = async (req, res) => {
  try {
    const docs = await CompanyTaskType.find({}).select('companyId companyName taskTypeIds').lean();

    const companyIds = Array.from(
      new Set(
        (docs || [])
          .map((d) => (d?.companyId ? d.companyId.toString() : ''))
          .filter(Boolean)
      )
    );

    const companies = companyIds.length
      ? await Company.find({ _id: { $in: companyIds }, isDeleted: { $ne: true } }).select('_id name').lean()
      : [];

    const companyNameById = new Map((companies || []).map((c) => [c._id.toString(), (c.name || '').toString()]));

    const allIds = Array.from(
      new Set(
        (docs || [])
          .flatMap((d) => (Array.isArray(d.taskTypeIds) ? d.taskTypeIds : []))
          .map((id) => id.toString())
          .filter(Boolean)
      )
    );

    const taskTypes = allIds.length
      ? await TaskType.find({ _id: { $in: allIds } }).select('_id name').sort({ name: 1 }).lean()
      : [];

    const nameById = new Map((taskTypes || []).map((t) => [t._id.toString(), (t.name || '').toString()]));

    const data = (docs || []).map((d) => {
      const cid = d?.companyId ? d.companyId.toString() : '';
      const ids = Array.isArray(d.taskTypeIds) ? d.taskTypeIds.map((id) => id.toString()).filter(Boolean) : [];
      const resolved = ids
        .map((id) => ({ id, name: nameById.get(id) || '' }))
        .filter((t) => t.name);

      return {
        id: d._id || '',
        companyId: cid,
        companyName: companyNameById.get(cid) || d.companyName || '',
        taskTypes: resolved
      };
    });

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

    const resolvedIds = new Set(normalizedTaskTypeIds);

    if (normalizedTaskTypeNames.length > 0) {
      for (const name of normalizedTaskTypeNames) {
        const doc = await TaskType.findOneAndUpdate(
          { name, companyId: company.id },
          { $set: { name, companyId: company.id, updatedBy: actorId }, $setOnInsert: { createdBy: actorId } },
          { new: true, upsert: true }
        );
        resolvedIds.add(doc._id.toString());
      }
    }

    const incomingIds = Array.from(resolvedIds);

    const existing = await CompanyTaskType.findOne({ companyId: company.id })
      .select('_id taskTypeIds companyName companyId')
      .lean();

    const legacy = !existing
      ? await CompanyTaskType.findOne({
        companyId: null,
        companyName: { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' }
      })
        .select('_id taskTypeIds companyName companyId')
        .lean()
      : null;

    const target = existing || legacy;

    const existingIds = Array.isArray(target?.taskTypeIds)
      ? target.taskTypeIds.map((id) => id.toString())
      : [];

    const mergedIds = Array.from(new Set([...existingIds, ...incomingIds]))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    const update = {
      companyId: company.id,
      companyName: company.name || target?.companyName || companyName,
      taskTypeIds: mergedIds,
      updatedBy: actorId
    };

    const saved = target?._id
      ? await CompanyTaskType.findByIdAndUpdate(
        target._id,
        { $set: update, $setOnInsert: { createdBy: actorId } },
        { new: true }
      ).lean()
      : await CompanyTaskType.create({ ...update, createdBy: actorId });

    const doc = saved?.toObject ? saved.toObject() : saved;

    const formatted = await formatCompanyTaskTypes(doc);
    return res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    if (error?.code === 11000) {
      try {
        const companyName = normalizeText(req.body?.companyName);
        const company = await resolveCompanyFromName(companyName);
        const existing = company?.id
          ? await CompanyTaskType.findOne({ companyId: company.id }).lean()
          : await CompanyTaskType.findOne({
            companyName: { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' }
          }).lean();
        if (existing) {
          const formatted = await formatCompanyTaskTypes(existing);
          return res.status(200).json({ success: true, data: formatted });
        }
      } catch {
        // ignore
      }
    }

    console.error('Error upserting company task types:', error);
    return res.status(500).json({ success: false, message: 'Failed to save company task types' });
  }
};
