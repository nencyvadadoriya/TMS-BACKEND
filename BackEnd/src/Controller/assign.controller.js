const mongoose = require('mongoose');

const User = require('../model/user.model');
const Brand = require('../model/Brand.model');
const TaskType = require('../model/TaskType.model');
const UserBrandTaskType = require('../model/UserBrandTaskType.model');
const CompanyBrandTaskType = require('../model/CompanyBrandTaskType.model');
const Company = require('../model/Company.model');

const normalizeText = (v) => (v || '').toString().trim();

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const companyNameToLooseRegex = (value) => {
  const compact = normalizeText(value).replace(/\s+/g, '');
  if (!compact) return null;
  const parts = compact.split('').map((ch) => escapeRegex(ch));
  return new RegExp(`^${parts.join('\\s*')}$`, 'i');
};

const resolveCanonicalCompanyName = async (companyName) => {
  const raw = normalizeText(companyName);
  if (!raw) return '';
  try {
    const rx = companyNameToLooseRegex(raw);
    if (!rx) return raw;
    const company = await Company.findOne({ name: { $regex: rx }, isDeleted: { $ne: true } })
      .select('name')
      .lean();
    return normalizeText(company?.name) || raw;
  } catch {
    return raw;
  }
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

    const companyRx = companyNameToLooseRegex(companyName);
    const companyQuery = companyRx
      ? { $regex: companyRx }
      : { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' };

    const users = await User.find({
      companyName: companyQuery
    })
      .select('_id name email role companyName managerId')
      .sort({ name: 1 })
      .lean();

    const mapped = (users || []).map((u) => ({
      id: u._id,
      name: u.name || u.email || '',
      email: u.email || '',
      role: u.role || 'assistant',
      companyName: u.companyName || '',
      managerId: u.managerId ? u.managerId.toString() : ''
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

    const companyRx = companyNameToLooseRegex(companyName);
    const companyQuery = companyRx
      ? { $regex: companyRx }
      : { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' };

    const docs = await UserBrandTaskType.find({
      companyName: companyQuery
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

    const companyRx = companyNameToLooseRegex(companyName);
    const companyQuery = companyRx
      ? { $regex: companyRx }
      : { $regex: `^${escapeRegex(companyName)}$`, $options: 'i' };

    const docs = await UserBrandTaskType.find({
      companyName: companyQuery,
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

    const canonicalCompanyName = await resolveCanonicalCompanyName(companyName);

    const brandId = await resolveBrandId({
      brandId: req.body?.brandId,
      brandName,
      companyName: canonicalCompanyName
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
        companyName: { $regex: `^${escapeRegex(canonicalCompanyName)}$`, $options: 'i' }
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
      companyName: canonicalCompanyName,
      userId,
      brandId,
      brandName,
      taskTypeIds,
      updatedBy: actorId
    };

    const doc = await UserBrandTaskType.findOneAndUpdate(
      { companyName: canonicalCompanyName, userId, brandId },
      { $set: update, $setOnInsert: { createdBy: actorId } },
      { new: true, upsert: true }
    ).lean();

    if (taskTypeIds.length > 0) {
      try {
        const owner = await User.findById(userId).select('_id role managerId').lean();
        const role = normalizeRole(owner?.role);
        const derived = [];
        if (role === 'rm') {
          const ams = await User.find({ role: { $regex: /^am$/i }, managerId: owner?._id, isDeleted: { $ne: true } })
            .select('_id')
            .lean();
          (ams || []).forEach((u) => derived.push(u?._id?.toString()));
        } else if (role === 'sbm') {
          const rms = await User.find({ role: { $regex: /^rm$/i }, managerId: owner?._id, isDeleted: { $ne: true } })
            .select('_id')
            .lean();
          const rmIds = (rms || []).map((u) => u?._id).filter(Boolean);
          (rmIds || []).forEach((id) => derived.push(id.toString()));
          const ams = rmIds.length
            ? await User.find({ role: { $regex: /^am$/i }, managerId: { $in: rmIds }, isDeleted: { $ne: true } })
              .select('_id')
              .lean()
            : [];
          (ams || []).forEach((u) => derived.push(u?._id?.toString()));
        }

        const derivedIds = Array.from(new Set(derived.filter((id) => mongoose.Types.ObjectId.isValid(id))));
        if (derivedIds.length > 0) {
          const existing = await UserBrandTaskType.find({
            companyName: canonicalCompanyName,
            userId: { $in: derivedIds },
            brandId
          })
            .select('userId brandId taskTypeIds')
            .lean();
          const existsKey = new Set(
            (existing || [])
              .filter((d) => Array.isArray(d?.taskTypeIds) && d.taskTypeIds.length > 0)
              .map((d) => `${d.userId?.toString()}::${d.brandId?.toString()}`)
          );

          const ops = derivedIds
            .filter((id) => !existsKey.has(`${id}::${brandId}`))
            .map((id) => ({
              updateOne: {
                filter: { companyName: canonicalCompanyName, userId: id, brandId },
                update: { $set: { ...update, userId: id }, $setOnInsert: { createdBy: actorId } },
                upsert: true
              }
            }));
          if (ops.length > 0) {
            await UserBrandTaskType.bulkWrite(ops, { ordered: false });
            try {
              await User.updateMany({ _id: { $in: derivedIds } }, { $addToSet: { assignedBrandIds: brandId } });
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }
    }

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
          companyName: canonicalCompanyName,
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

exports.bulkUpsertAssignments = async (req, res) => {
  try {
    const companyName = normalizeText(req.body?.companyName);
    const userId = toObjectIdString(req.body?.userId);
    const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    if (!companyName || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Valid companyName and userId are required' });
    }

    if (mappings.length === 0) {
      return res.status(200).json({ success: true, data: { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 } });
    }

    const canonicalCompanyName = await resolveCanonicalCompanyName(companyName);

    const mappingDocs = await CompanyBrandTaskType.find({
      companyName: { $regex: `^${escapeRegex(canonicalCompanyName)}$`, $options: 'i' }
    })
      .select('taskTypeIds')
      .lean();

    const allowed = new Set(
      (mappingDocs || [])
        .flatMap((d) => (Array.isArray(d.taskTypeIds) ? d.taskTypeIds : []))
        .map((id) => id.toString())
        .filter(Boolean)
    );

    const ops = [];
    const brandsToAdd = new Set();
    const brandsToMaybeRemove = new Set();

    for (const row of mappings) {
      const brandId = toObjectIdString(row?.brandId);
      const brandName = normalizeText(row?.brandName);
      if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) continue;

      const rawTaskTypeIds = Array.isArray(row?.taskTypeIds) ? row.taskTypeIds : [];
      const taskTypeIds = rawTaskTypeIds
        .map((v) => (v == null ? '' : String(v)).trim())
        .filter(Boolean)
        .filter((id) => mongoose.Types.ObjectId.isValid(id));

      if (rawTaskTypeIds.length > 0 && taskTypeIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid taskTypeIds: expected Mongo ObjectIds'
        });
      }

      if (allowed.size > 0) {
        const invalid = taskTypeIds.filter((id) => !allowed.has(id));
        if (invalid.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Selected task types are not allowed for this company'
          });
        }
      }

      if (taskTypeIds.length > 0) brandsToAdd.add(brandId);
      else brandsToMaybeRemove.add(brandId);

      const update = {
        companyName: canonicalCompanyName,
        userId,
        brandId,
        brandName,
        taskTypeIds,
        updatedBy: actorId
      };

      ops.push({
        updateOne: {
          filter: { companyName: canonicalCompanyName, userId, brandId },
          update: { $set: update, $setOnInsert: { createdBy: actorId } },
          upsert: true
        }
      });
    }

    if (ops.length === 0) {
      return res.status(200).json({ success: true, data: { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 } });
    }

    const result = await UserBrandTaskType.bulkWrite(ops, { ordered: false });

    try {
      const owner = await User.findById(userId).select('_id role managerId').lean();
      const role = normalizeRole(owner?.role);
      const derived = [];
      if (role === 'rm') {
        const ams = await User.find({ role: { $regex: /^am$/i }, managerId: owner?._id, isDeleted: { $ne: true } })
          .select('_id')
          .lean();
        (ams || []).forEach((u) => derived.push(u?._id?.toString()));
      } else if (role === 'sbm') {
        const rms = await User.find({ role: { $regex: /^rm$/i }, managerId: owner?._id, isDeleted: { $ne: true } })
          .select('_id')
          .lean();
        const rmIds = (rms || []).map((u) => u?._id).filter(Boolean);
        (rmIds || []).forEach((id) => derived.push(id.toString()));
        const ams = rmIds.length
          ? await User.find({ role: { $regex: /^am$/i }, managerId: { $in: rmIds }, isDeleted: { $ne: true } })
            .select('_id')
            .lean()
          : [];
        (ams || []).forEach((u) => derived.push(u?._id?.toString()));
      }

      const derivedIds = Array.from(new Set(derived.filter((id) => mongoose.Types.ObjectId.isValid(id))));
      if (derivedIds.length > 0) {
        const positive = mappings
          .map((row) => ({
            brandId: toObjectIdString(row?.brandId),
            brandName: normalizeText(row?.brandName),
            taskTypeIds: Array.isArray(row?.taskTypeIds)
              ? row.taskTypeIds.map((v) => (v == null ? '' : String(v)).trim()).filter((id) => mongoose.Types.ObjectId.isValid(id))
              : []
          }))
          .filter((m) => m.brandId && mongoose.Types.ObjectId.isValid(m.brandId) && Array.isArray(m.taskTypeIds) && m.taskTypeIds.length > 0);

        if (positive.length > 0) {
          const brandIds = Array.from(new Set(positive.map((m) => m.brandId)));
          const existing = await UserBrandTaskType.find({
            companyName: canonicalCompanyName,
            userId: { $in: derivedIds },
            brandId: { $in: brandIds }
          })
            .select('userId brandId taskTypeIds')
            .lean();
          const existsKey = new Set(
            (existing || [])
              .filter((d) => Array.isArray(d?.taskTypeIds) && d.taskTypeIds.length > 0)
              .map((d) => `${d.userId?.toString()}::${d.brandId?.toString()}`)
          );

          const derivedOps = [];
          const derivedBrandsToAdd = new Set();
          for (const childId of derivedIds) {
            for (const m of positive) {
              const key = `${childId}::${m.brandId}`;
              if (existsKey.has(key)) continue;
              derivedBrandsToAdd.add(m.brandId);
              derivedOps.push({
                updateOne: {
                  filter: { companyName: canonicalCompanyName, userId: childId, brandId: m.brandId },
                  update: {
                    $set: {
                      companyName: canonicalCompanyName,
                      userId: childId,
                      brandId: m.brandId,
                      brandName: m.brandName,
                      taskTypeIds: m.taskTypeIds,
                      updatedBy: actorId
                    },
                    $setOnInsert: { createdBy: actorId }
                  },
                  upsert: true
                }
              });
            }
          }

          if (derivedOps.length > 0) {
            await UserBrandTaskType.bulkWrite(derivedOps, { ordered: false });
            try {
              if (derivedBrandsToAdd.size > 0) {
                await User.updateMany(
                  { _id: { $in: derivedIds } },
                  { $addToSet: { assignedBrandIds: { $each: Array.from(derivedBrandsToAdd) } } }
                );
              }
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore
    }

    try {
      if (brandsToAdd.size > 0) {
        await User.findByIdAndUpdate(userId, { $addToSet: { assignedBrandIds: { $each: Array.from(brandsToAdd) } } });
      }
    } catch {
      // ignore
    }

    try {
      if (brandsToMaybeRemove.size > 0) {
        const stillHasAny = await UserBrandTaskType.find({
          companyName: canonicalCompanyName,
          userId,
          brandId: { $in: Array.from(brandsToMaybeRemove) },
          taskTypeIds: { $exists: true, $ne: [] }
        })
          .select('brandId')
          .lean();

        const keep = new Set((stillHasAny || []).map((d) => (d?.brandId ? d.brandId.toString() : '')).filter(Boolean));
        const toRemove = Array.from(brandsToMaybeRemove).filter((id) => !keep.has(id));
        if (toRemove.length > 0) {
          await User.findByIdAndUpdate(userId, { $pull: { assignedBrandIds: { $in: toRemove } } });
        }
      }
    } catch {
      // ignore
    }

    return res.status(200).json({
      success: true,
      data: {
        matchedCount: result?.matchedCount ?? result?.nMatched,
        modifiedCount: result?.modifiedCount ?? result?.nModified,
        upsertedCount: result?.upsertedCount ?? (result?.upsertedIds ? Object.keys(result.upsertedIds).length : 0)
      }
    });
  } catch (error) {
    console.error('Error bulk upserting assignments:', error);
    return res.status(500).json({ success: false, message: 'Failed to save assignments' });
  }
};
