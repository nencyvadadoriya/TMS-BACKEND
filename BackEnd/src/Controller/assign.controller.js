const mongoose = require('mongoose');

const User = require('../model/user.model');
const Brand = require('../model/Brand.model');
const TaskType = require('../model/TaskType.model');
const UserBrandTaskType = require('../model/UserBrandTaskType.model');
const CompanyBrandTaskType = require('../model/CompanyBrandTaskType.model');
const Company = require('../model/Company.model');

const normalizeText = (v) => (v || '').toString().trim();

const escapeRegex = (value) => {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const toObjectIdString = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') return String(v._id || v.id || '').trim();
  return '';
};

const normalizeRole = (value) => String(value || '').trim().toLowerCase();

const resolveBrandId = async ({ brandId, brandName, companyName }) => {
  const rawId = toObjectIdString(brandId);
  if (rawId && mongoose.Types.ObjectId.isValid(rawId)) return rawId;

  const name = normalizeText(brandName);
  if (!name) return '';

  const company = normalizeText(companyName);
  const query = {
    name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' }
  };
  if (company) {
    query.company = { $regex: `^${escapeRegex(company)}$`, $options: 'i' };
  }

  const brand = await Brand.findOne(query).select('_id name company').lean();
  return brand?._id ? brand._id.toString() : '';
};

exports.assignCompaniesToMdManager = async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user?.role);

    if (actorRole !== 'admin' && actorRole !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const mdManagerId = toObjectIdString(req.body?.mdManagerId);
    const rawCompanyIds = Array.isArray(req.body?.companyIds) ? req.body.companyIds : [];
    const companyIds = rawCompanyIds
      .map((v) => toObjectIdString(v))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (!mongoose.Types.ObjectId.isValid(mdManagerId)) {
      return res.status(400).json({ success: false, message: 'Valid mdManagerId is required' });
    }

    const target = await User.findById(mdManagerId).select('_id role assignedCompanyIds name email').lean();
    if (!target) {
      return res.status(404).json({ success: false, message: 'MD Manager not found' });
    }

    if (normalizeRole(target.role) !== 'md_manager') {
      return res.status(400).json({ success: false, message: 'Target user must be an MD Manager' });
    }

    if (companyIds.length > 0) {
      const existing = await Company.countDocuments({ _id: { $in: companyIds }, isDeleted: { $ne: true } });
      if (existing !== companyIds.length) {
        return res.status(400).json({ success: false, message: 'One or more companies are invalid or deleted' });
      }
    }

    const updated = await User.findByIdAndUpdate(
      mdManagerId,
      {
        $set: {
          assignedCompanyIds: companyIds,
          updatedAt: new Date()
        }
      },
      { new: true }
    )
      .select('_id name email role assignedCompanyIds')
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        id: updated?._id,
        _id: updated?._id,
        name: updated?.name || '',
        email: updated?.email || '',
        role: updated?.role || '',
        assignedCompanyIds: Array.isArray(updated?.assignedCompanyIds)
          ? updated.assignedCompanyIds.map((x) => x.toString())
          : []
      },
      message: 'Companies assigned successfully'
    });
  } catch (error) {
    console.error('Error assigning companies to MD Manager:', error);
    return res.status(500).json({ success: false, message: 'Failed to assign companies' });
  }
};

exports.assignCompaniesToObManager = async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user?.role);

    if (actorRole !== 'admin' && actorRole !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const obManagerId = toObjectIdString(req.body?.obManagerId);
    const rawCompanyIds = Array.isArray(req.body?.companyIds) ? req.body.companyIds : [];
    const companyIds = rawCompanyIds
      .map((v) => toObjectIdString(v))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (!mongoose.Types.ObjectId.isValid(obManagerId)) {
      return res.status(400).json({ success: false, message: 'Valid obManagerId is required' });
    }

    const target = await User.findById(obManagerId).select('_id role assignedCompanyIds name email').lean();
    if (!target) {
      return res.status(404).json({ success: false, message: 'OB Manager not found' });
    }

    if (normalizeRole(target.role) !== 'ob_manager') {
      return res.status(400).json({ success: false, message: 'Target user must be an OB Manager' });
    }

    if (companyIds.length > 0) {
      const existing = await Company.countDocuments({ _id: { $in: companyIds }, isDeleted: { $ne: true } });
      if (existing !== companyIds.length) {
        return res.status(400).json({ success: false, message: 'One or more companies are invalid or deleted' });
      }
    }

    const updated = await User.findByIdAndUpdate(
      obManagerId,
      {
        $set: {
          assignedCompanyIds: companyIds,
          updatedAt: new Date()
        }
      },
      { new: true }
    )
      .select('_id name email role assignedCompanyIds')
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        id: updated?._id,
        _id: updated?._id,
        name: updated?.name || '',
        email: updated?.email || '',
        role: updated?.role || '',
        assignedCompanyIds: Array.isArray(updated?.assignedCompanyIds)
          ? updated.assignedCompanyIds.map((x) => x.toString())
          : []
      },
      message: 'Companies assigned successfully'
    });
  } catch (error) {
    console.error('Error assigning companies to OB Manager:', error);
    return res.status(500).json({ success: false, message: 'Failed to assign companies' });
  }
};

exports.assignCompaniesToSbm = async (req, res) => {
  try {
    const actorRole = normalizeRole(req.user?.role);

    if (actorRole !== 'admin' && actorRole !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const sbmId = toObjectIdString(req.body?.sbmId);
    const rawCompanyIds = Array.isArray(req.body?.companyIds) ? req.body.companyIds : [];
    const companyIds = rawCompanyIds
      .map((v) => toObjectIdString(v))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (!mongoose.Types.ObjectId.isValid(sbmId)) {
      return res.status(400).json({ success: false, message: 'Valid sbmId is required' });
    }

    const target = await User.findById(sbmId).select('_id role assignedCompanyIds name email').lean();
    if (!target) {
      return res.status(404).json({ success: false, message: 'SBM not found' });
    }

    if (normalizeRole(target.role) !== 'sbm') {
      return res.status(400).json({ success: false, message: 'Target user must be an SBM' });
    }

    if (companyIds.length > 0) {
      const existing = await Company.countDocuments({ _id: { $in: companyIds }, isDeleted: { $ne: true } });
      if (existing !== companyIds.length) {
        return res.status(400).json({ success: false, message: 'One or more companies are invalid or deleted' });
      }
    }

    const updated = await User.findByIdAndUpdate(
      sbmId,
      {
        $set: {
          assignedCompanyIds: companyIds,
          updatedAt: new Date()
        }
      },
      { new: true }
    )
      .select('_id name email role assignedCompanyIds')
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        id: updated?._id,
        _id: updated?._id,
        name: updated?.name || '',
        email: updated?.email || '',
        role: updated?.role || '',
        assignedCompanyIds: Array.isArray(updated?.assignedCompanyIds)
          ? updated.assignedCompanyIds.map((x) => x.toString())
          : []
      },
      message: 'Companies assigned successfully'
    });
  } catch (error) {
    console.error('Error assigning companies to SBM:', error);
    return res.status(500).json({ success: false, message: 'Failed to assign companies' });
  }
};

exports.getCompanyUsers = async (req, res) => {
  try {
    const companyName = normalizeText(req.query?.companyName);
    if (!companyName) {
      return res.status(200).json({ success: true, data: [] });
    }

    const users = await User.find({
      companyName: { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' }
    })
      .select('_id name email role companyName')
      .sort({ name: 1 })
      .lean();

    const mapped = (users || []).map((u) => ({
      id: u._id,
      name: u.name || u.email || '',
      email: u.email || '',
      role: u.role || 'assistant',
      companyName: u.companyName || ''
    }));

    return res.status(200).json({ success: true, data: mapped });
  } catch (error) {
    console.error('Error fetching company users:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch company users' });
  }
};

exports.getAssignmentsForCompany = async (req, res) => {
  try {
    const companyName = normalizeText(req.query?.companyName);
    if (!companyName) {
      return res.status(200).json({ success: true, data: [] });
    }

    const docs = await UserBrandTaskType.find({
      companyName: { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' }
    })
      .select('_id companyName userId brandId brandName taskTypeIds')
      .lean();

    const mapped = (docs || []).map((d) => ({
      id: d._id,
      companyName: d.companyName || companyName,
      userId: d.userId?.toString() || '',
      brandId: d.brandId?.toString() || '',
      brandName: d.brandName || '',
      taskTypeIds: Array.isArray(d.taskTypeIds) ? d.taskTypeIds.map((id) => id.toString()) : []
    }));

    return res.status(200).json({ success: true, data: mapped });
  } catch (error) {
    console.error('Error fetching assignments for company:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch assignments' });
  }
};

exports.getAssignmentsForUser = async (req, res) => {
  try {
    const companyName = normalizeText(req.query?.companyName);
    const userId = toObjectIdString(req.query?.userId);

    if (!companyName || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(200).json({ success: true, data: [] });
    }

    const docs = await UserBrandTaskType.find({
      companyName: { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' },
      userId
    }).lean();

    const brandIds = Array.from(new Set((docs || []).map((d) => d.brandId?.toString()).filter(Boolean)));
    const taskTypeIds = Array.from(
      new Set(
        (docs || [])
          .flatMap((d) => (Array.isArray(d.taskTypeIds) ? d.taskTypeIds : []))
          .map((id) => id.toString())
          .filter(Boolean)
      )
    );

    const [brands, taskTypes] = await Promise.all([
      brandIds.length ? Brand.find({ _id: { $in: brandIds } }).select('_id name company').lean() : [],
      taskTypeIds.length ? TaskType.find({ _id: { $in: taskTypeIds } }).select('_id name').lean() : []
    ]);

    const taskTypeNameById = new Map((taskTypes || []).map((t) => [t._id.toString(), (t.name || '').toString()]));

    const brandById = new Map((brands || []).map((b) => [b._id.toString(), b]));

    const mapped = (docs || []).map((d) => {
      const bid = d.brandId?.toString() || '';
      const brand = brandById.get(bid);
      const ids = Array.isArray(d.taskTypeIds) ? d.taskTypeIds.map((id) => id.toString()) : [];
      return {
        id: d._id,
        companyName: d.companyName || companyName,
        userId: d.userId?.toString() || userId,
        brandId: bid,
        brandName: d.brandName || brand?.name || '',
        taskTypeIds: ids,
        taskTypes: ids
          .map((id) => ({ id, name: taskTypeNameById.get(id) || '' }))
          .filter((t) => Boolean(t.name))
      };
    });

    return res.status(200).json({ success: true, data: mapped });
  } catch (error) {
    console.error('Error fetching assignments for user:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch assignments' });
  }
};

exports.upsertAssignment = async (req, res) => {
  try {
    const companyName = normalizeText(req.body?.companyName);
    const userId = toObjectIdString(req.body?.userId);
    const brandName = normalizeText(req.body?.brandName);

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    if (!companyName || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Valid companyName and userId are required' });
    }

    const brandId = await resolveBrandId({
      brandId: req.body?.brandId,
      brandName,
      companyName
    });

    if (!brandId) {
      return res.status(400).json({ success: false, message: 'Valid brand is required' });
    }

    const rawTaskTypeIds = Array.isArray(req.body?.taskTypeIds) ? req.body.taskTypeIds : [];
    const rawNormalized = rawTaskTypeIds
      .map((v) => (v == null ? '' : String(v)).trim())
      .filter(Boolean);

    const fromIds = rawNormalized.filter((v) => mongoose.Types.ObjectId.isValid(v));
    const maybeNames = rawNormalized.filter((v) => !mongoose.Types.ObjectId.isValid(v));

    let resolvedIds = [...fromIds];
    if (maybeNames.length > 0) {
      try {
        const docs = await TaskType.find({ name: { $in: maybeNames } }).select('_id name').lean();
        const extra = (docs || []).map((t) => (t?._id ? t._id.toString() : '')).filter(Boolean);
        resolvedIds = Array.from(new Set([...resolvedIds, ...extra]));
      } catch {
        // ignore
      }
    }

    const taskTypeIds = resolvedIds
      .map((v) => toObjectIdString(v))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (rawNormalized.length > 0 && taskTypeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid taskTypeIds: expected Mongo ObjectIds or existing task type names'
      });
    }

    if (taskTypeIds.length > 0) {
      const mappingDocs = await CompanyBrandTaskType.find({
        companyName: { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' }
      })
        .select('taskTypeIds')
        .lean();

      const allowed = new Set(
        (mappingDocs || [])
          .flatMap((d) => (Array.isArray(d.taskTypeIds) ? d.taskTypeIds : []))
          .map((id) => id.toString())
          .filter(Boolean)
      );

      if (allowed.size > 0) {
        const invalid = taskTypeIds.filter((id) => !allowed.has(id));
        if (invalid.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Selected task types are not allowed for this company'
          });
        }
      }
    }

    const update = {
      companyName,
      userId,
      brandId,
      brandName,
      taskTypeIds,
      updatedBy: actorId
    };

    const doc = await UserBrandTaskType.findOneAndUpdate(
      { companyName, userId, brandId },
      { $set: update, $setOnInsert: { createdBy: actorId } },
      { new: true, upsert: true }
    ).lean();

    if (taskTypeIds.length > 0) {
      try {
        await User.findByIdAndUpdate(userId, {
          $addToSet: { assignedBrandIds: brandId }
        });
      } catch {
        // ignore
      }
    } else {
      try {
        const stillHasAny = await UserBrandTaskType.exists({
          companyName,
          userId,
          brandId,
          taskTypeIds: { $exists: true, $ne: [] }
        });
        if (!stillHasAny) {
          await User.findByIdAndUpdate(userId, {
            $pull: { assignedBrandIds: brandId }
          });
        }
      } catch {
        // ignore
      }
    }

    return res.status(200).json({ success: true, data: { ...doc, id: doc._id } });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate assignment detected (check UserBrandTaskType unique indexes)'
      });
    }
    console.error('Error upserting assignment:', error);
    return res.status(500).json({ success: false, message: 'Failed to save assignment' });
  }
};
