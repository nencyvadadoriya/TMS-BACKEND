const mongoose = require('mongoose');
const Brand = require('../model/Brand.model');
const Task = require('../model/Task.model');
const User = require('../model/user.model');
const Company = require('../model/Company.model');
const UserBrandTaskType = require('../model/UserBrandTaskType.model');
const CompanyBrandTaskType = require('../model/CompanyBrandTaskType.model');
const TaskType = require('../model/TaskType.model');
const TaskHistory = require('../model/TaskHistory.model');

const { emitBrandUpserted, emitBrandDeleted } = require('../realtime/brandEvents');
const { emitUserUpserted } = require('../realtime/userEvents');
const { getEffectivePermissionForUser } = require('../middleware/permission.middleware');

const normalizeEmail = (email) => (email || '').toString().trim().toLowerCase();

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildEmailMatchQuery = (emails) => {
  const list = (Array.isArray(emails) ? emails : [])
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
  if (list.length === 0) return { email: { $in: [] } };

  return {
    $or: list.map((email) => ({
      email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' }
    }))
  };
};

const resolveCanonicalCompanyName = async (companyName) => {
  const raw = normalizeString(companyName);
  if (!raw) return '';
  try {
    const company = await Company.findOne({
      name: { $regex: `^${escapeRegex(raw)}$`, $options: 'i' },
      isDeleted: { $ne: true }
    })
      .select('name')
      .lean();
    return normalizeString(company?.name) || raw;
  } catch {
    return raw;
  }
};

const resolveAllowedCompanyNamesForUser = async (user) => {
  try {
    const startId = (user?.id || user?._id || '').toString();
    if (!mongoose.Types.ObjectId.isValid(startId)) return [];

    let currentId = startId;
    let fallbackCompany = '';
    for (let depth = 0; depth < 8; depth++) {
      const dbUser = await User.findById(currentId).select('assignedCompanyIds managerId companyName').lean();
      if (!dbUser) return fallbackCompany ? [fallbackCompany] : [];

      if (!fallbackCompany) {
        fallbackCompany = (dbUser?.companyName || '').toString().trim();
      }

      const companyIds = Array.isArray(dbUser?.assignedCompanyIds) ? dbUser.assignedCompanyIds : [];
      if (companyIds.length > 0) {
        const companies = await Company.find({
          _id: { $in: companyIds },
          isDeleted: { $ne: true }
        }).select('name').lean();

        return (companies || []).map((c) => (c?.name || '').toString().trim()).filter(Boolean);
      }

      const nextManagerId = (dbUser?.managerId || '').toString();
      if (!mongoose.Types.ObjectId.isValid(nextManagerId)) return fallbackCompany ? [fallbackCompany] : [];
      currentId = nextManagerId;
    }

    return fallbackCompany ? [fallbackCompany] : [];
  } catch {
    return [];
  }
};

const withAssignedBrandIds = async (user) => {
  try {
    const role = String(user?.role || '').toLowerCase();
    if (role !== 'manager' && role !== 'md_manager' && role !== 'assistant' && role !== 'sbm' && role !== 'rm' && role !== 'am' && role !== 'sales_manager' && role !== 'sales_man') return user;

    const id = (user?.id || user?._id || '').toString();
    if (!mongoose.Types.ObjectId.isValid(id)) return user;

    const assignedBrandIds = new Set();
    let managerId = null;
    let currentId = id;
    const maxDepth = role === 'rm' || role === 'am' ? 1 : 8;
    for (let depth = 0; depth < maxDepth; depth++) {
      const dbUser = await User.findById(currentId).select('assignedBrandIds managerId').lean();
      if (!dbUser) break;

      (Array.isArray(dbUser?.assignedBrandIds) ? dbUser.assignedBrandIds : [])
        .map(String)
        .filter(Boolean)
        .forEach((bid) => assignedBrandIds.add(bid));

      managerId = managerId || dbUser?.managerId || null;

      const nextManagerId = (dbUser?.managerId || '').toString();
      if (!mongoose.Types.ObjectId.isValid(nextManagerId)) break;
      currentId = nextManagerId;
    }

    let allowedCompanyNames = undefined;
    if (role === 'md_manager') {
      allowedCompanyNames = await resolveAllowedCompanyNamesForUser({ id });
    }

    return {
      ...user,
      assignedBrandIds: Array.from(assignedBrandIds),
      managerId: user?.managerId || managerId || null,
      allowedCompanyNames
    };
  } catch {
    return user;
  }
};

const userCanAccessBrand = (brand, user) => {
  if (!brand || !user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'super_admin') return true;

  const userEmail = normalizeEmail(user.email);
  const assigned = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds.map(String) : [];

  const brandId = String(brand._id || brand.id || '');
  const hasAssignedAccess = brandId && assigned.includes(brandId);

  if (role === 'assistant' || role === 'sbm' || role === 'rm' || role === 'am' || role === 'sales_manager' || role === 'sales_man') {
    const isSalesRole = role === 'sales_manager' || role === 'sales_man';
    if (isSalesRole) {
      const brandCompany = normalizeText(brand.company);
      if (brandCompany.replace(/\s+/g, '').toLowerCase() === 'speedecom') return true;
    }
    return Boolean(hasAssignedAccess);
  }

  const isOwner = brand.owner && brand.owner.toString() === (user.id || user._id || '').toString();
  if (role === 'md_manager') {
    const allowedCompanies = Array.isArray(user.allowedCompanyNames) ? user.allowedCompanyNames : [];
    const brandCompany = (brand.company || '').toString().trim().toLowerCase();
    const companyAllowed = allowedCompanies.some((c) => (c || '').toString().trim().toLowerCase() === brandCompany);
    if (companyAllowed) return true;
  }

  if (role === 'manager' || role === 'md_manager') {
    const isAcceptedCollaborator = (brand.collaborators || []).some(c => normalizeEmail(c.email) === userEmail && (c.status === 'accepted' || c.status === 'active'));
    return Boolean(isOwner || hasAssignedAccess || isAcceptedCollaborator);
  }

  const isAcceptedCollaborator = (brand.collaborators || []).some(c => normalizeEmail(c.email) === userEmail && (c.status === 'accepted' || c.status === 'active'));
  return Boolean(isOwner || isAcceptedCollaborator);
};

exports.getBrandHistoryFeed = async (req, res) => {
  try {
    const user = await withAssignedBrandIds(req.user);
    const requesterEmail = normalizeEmail(user?.email);
    const role = String(user?.role || '').toLowerCase();
    const requesterId = (user?.id || user?._id || '').toString();

    const pageRaw = Number(req.query?.page);
    const limitRaw = Number(req.query?.limit);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 30;

    let query = {};

    if (role === 'admin' || role === 'super_admin') {
      query = {};
    } else if (role === 'md_manager') {
      const allowedCompanies = Array.isArray(user?.allowedCompanyNames)
        ? user.allowedCompanyNames
        : await resolveAllowedCompanyNamesForUser(user);
      if (allowedCompanies.length === 0) {
        return res.status(200).json({ success: true, data: [], total: 0, page, limit });
      }
      query = {
        $or: allowedCompanies.map((name) => ({
          company: { $regex: `^${escapeRegex(name)}$`, $options: 'i' }
        }))
      };
    } else if (role === 'manager') {
      const assignedBrandIds = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds : [];
      query = {
        $or: [
          { _id: { $in: assignedBrandIds } },
          { owner: requesterId },
          { 'collaborators.email': requesterEmail, 'collaborators.status': { $in: ['accepted', 'active'] } }
        ]
      };
    } else if (role === 'assistant' || role === 'rm' || role === 'am') {
      const assignedBrandIds = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds : [];
      query = { _id: { $in: assignedBrandIds } };
    } else if (role === 'sbm') {
      const assignedBrandIds = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds : [];
      const allowedCompanies = await resolveAllowedCompanyNamesForUser(user);

      const companyOr = (Array.isArray(allowedCompanies) ? allowedCompanies : [])
        .map((name) => normalizeString(name))
        .filter(Boolean)
        .map((name) => ({ company: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } }));

      query = {
        $or: [
          { _id: { $in: assignedBrandIds } },
          ...companyOr
        ]
      };
    } else {
      query = {
        $or: [
          { owner: requesterId },
          { 'collaborators.email': requesterEmail, 'collaborators.status': { $in: ['accepted', 'active'] } }
        ]
      };
    }

    const includeDeleted = String(req.query?.includeDeleted || '').toLowerCase() === 'true';
    if (!includeDeleted) {
      query = { $and: [query, { isDeleted: { $ne: true } }] };
    }

    const matchStage = query;
    const totalAgg = await Brand.aggregate([
      { $match: matchStage },
      { $unwind: '$history' },
      { $count: 'count' }
    ]);
    const total = Number(totalAgg?.[0]?.count || 0);

    const rows = await Brand.aggregate([
      { $match: matchStage },
      { $project: { name: 1, company: 1, groupNumber: 1, groupName: 1, history: 1 } },
      { $unwind: '$history' },
      { $addFields: { _ts: { $ifNull: ['$history.timestamp', '$history.createdAt'] } } },
      { $sort: { _ts: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ]);

    const data = (rows || []).map((r) => ({
      ...(r?.history || {}),
      timestamp: (r?.history?.timestamp || r?.history?.createdAt || new Date().toISOString()),
      _brandId: (r?._id || '').toString(),
      _brandName: (r?.name || '').toString(),
      _brandCompany: (r?.company || '').toString(),
      _brandGroupNumber: (r?.groupNumber || '').toString(),
      _brandGroupName: (r?.groupName || '').toString(),
    }));

    res.status(200).json({ success: true, data, total, page, limit });
  } catch (error) {
    console.error('Error fetching brand history feed:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch brand history' });
  }
};

const computeTaskStats = (tasks) => {
  const now = new Date();
  const isOverdue = (t) => {
    if (!t?.dueDate) return false;
    if (t.status === 'completed') return false;
    return new Date(t.dueDate) < now;
  };

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length;
  const overdueTasks = tasks.filter(isOverdue).length;

  return {
    totalTasks,
    completedTasks,
    pendingTasks,
    inProgressTasks,
    overdueTasks
  };
};

const normalizeString = (v) => (v || '').toString().trim();

const normalizeText = (v) => normalizeString(v).toLowerCase();

const normalizeCompanyKey = (company) => normalizeString(company).toLowerCase().replace(/\s+/g, '');

const companyNameToLooseRegex = (value) => {
  const compact = normalizeString(value).replace(/\s+/g, '');
  if (!compact) return null;
  const parts = compact.split('').map((ch) => escapeRegex(ch));
  return new RegExp(`^${parts.join('\\s*')}$`, 'i');
};

const formatTaskHistoryEntry = (entry) => ({
  ...entry,
  id: entry?._id,
  userName: entry?.user?.userName || entry?.userName || 'System',
  userEmail: entry?.user?.userEmail || entry?.userEmail || 'system@task-app.local',
  userRole: entry?.user?.userRole || entry?.userRole || 'system',
  timestamp: entry?.timestamp || entry?.createdAt || entry?.updatedAt
});

const withTaskHistory = async (tasks) => {
  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length === 0) return list;

  const taskIds = list
    .map(t => t?._id)
    .filter(Boolean);

  if (taskIds.length === 0) return list;

  const allHistory = await TaskHistory.find({ taskId: { $in: taskIds } })
    .sort({ timestamp: -1 })
    .lean();

  const byTaskId = new Map();
  allHistory.forEach((h) => {
    const key = h?.taskId ? String(h.taskId) : '';
    if (!key) return;
    const existing = byTaskId.get(key) || [];
    existing.push(formatTaskHistoryEntry(h));
    byTaskId.set(key, existing);
  });

  return list.map((t) => ({
    ...t,
    history: byTaskId.get(String(t._id)) || []
  }));
};

const buildBrandPayload = (body) => {
  const name = normalizeString(body?.name);
  const company = normalizeString(body?.company);
  const category = normalizeString(body?.category) || 'Other';
  const website = normalizeString(body?.website);
  const logo = body?.logo ? body.logo.toString() : '';
  const status = normalizeString(body?.status) || 'active';

  const groupNumber = normalizeString(body?.groupNumber);
  const groupName = normalizeString(body?.groupName);

  return {
    name,
    company,
    category,
    groupNumber,
    groupName,
    website,
    logo,
    status
  };
};

const assignBrandToUsersByEmail = async ({ brandId, rmEmail, amEmail }) => {
  try {
    const bid = (brandId || '').toString();
    if (!mongoose.Types.ObjectId.isValid(bid)) return;

    const rmKey = normalizeEmail(rmEmail);
    const amKey = normalizeEmail(amEmail);
    const emails = [rmKey, amKey].filter(Boolean);
    if (!emails.length) return;

    const users = await User.find(buildEmailMatchQuery(emails))
      .select('_id email managerId')
      .lean();

    const byEmail = new Map((users || []).map((u) => [normalizeEmail(u?.email), u]));
    const rmUser = rmKey ? byEmail.get(rmKey) : null;
    const amUser = amKey ? byEmail.get(amKey) : null;

    const userIds = (users || [])
      .map((u) => (u?._id ? u._id.toString() : ''))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    const uniqueUserIds = Array.from(new Set(userIds));
    if (!uniqueUserIds.length) return;

    await User.updateMany(
      { _id: { $in: uniqueUserIds } },
      { $addToSet: { assignedBrandIds: bid } }
    );
  } catch {
    // ignore assignment errors
  }
};

const formatBrand = (b) => ({
  ...b,
  id: b._id
});

exports.createBrand = async (req, res) => {
  try {
    const ownerId = (req.user?.id || req.user?._id || '').toString();
    if (!mongoose.Types.ObjectId.isValid(ownerId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const creatorRole = String(req.user?.role || '').toLowerCase();

    const payload = buildBrandPayload(req.body);
    if (!payload.name) {
      return res.status(400).json({ success: false, message: 'Brand name is required' });
    }

    const existing = await Brand.findOne({
      owner: ownerId,
      name: payload.name,
      company: payload.company
    });

    if (existing) {
      existing.status = payload.status;

      existing.history.push({
        action: 'brand_updated',
        message: `Brand updated: ${payload.name}`,
        userId: ownerId,
        userName: req.user?.name || 'Unknown',
        userEmail: normalizeEmail(req.user?.email),
        userRole: req.user?.role || 'user',
        timestamp: new Date(),
        metadata: { name: payload.name, company: payload.company }
      });

      await existing.save();
      await assignBrandToUsersByEmail({
        brandId: existing._id,
        rmEmail: req.body?.rmEmail,
        amEmail: req.body?.amEmail
      });

      if (creatorRole === 'sbm') {
        try {
          const updatedUser = await User.findByIdAndUpdate(
            ownerId,
            { $addToSet: { assignedBrandIds: existing._id } },
            { new: true }
          ).lean();
          if (updatedUser?._id) {
            try {
              emitUserUpserted({
                ...updatedUser,
                id: updatedUser._id,
                assignedBrandIds: Array.isArray(updatedUser.assignedBrandIds) ? updatedUser.assignedBrandIds : [],
                assignedCompanyIds: Array.isArray(updatedUser.assignedCompanyIds) ? updatedUser.assignedCompanyIds : []
              });
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }

      try {
        emitBrandUpserted(formatBrand(existing.toObject()));
      } catch (emitError) {
        console.error('emitBrandUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
      }

      return res.status(200).json({ success: true, data: formatBrand(existing.toObject()) });
    }

    const created = await Brand.create({
      ...payload,
      owner: ownerId,
      collaborators: [],
      history: [
        {
          action: 'brand_created',
          message: `Brand created: ${payload.name}`,
          userId: ownerId,
          userName: req.user?.name || 'Unknown',
          userEmail: normalizeEmail(req.user?.email),
          userRole: req.user?.role || 'user',
          timestamp: new Date(),
          metadata: { name: payload.name, company: payload.company }
        }
      ]
    });
    await assignBrandToUsersByEmail({
      brandId: created._id,
      rmEmail: req.body?.rmEmail,
      amEmail: req.body?.amEmail
    });

    if (creatorRole === 'sbm') {
      try {
        const updatedUser = await User.findByIdAndUpdate(
          ownerId,
          { $addToSet: { assignedBrandIds: created._id } },
          { new: true }
        ).lean();
        if (updatedUser?._id) {
          try {
            emitUserUpserted({
              ...updatedUser,
              id: updatedUser._id,
              assignedBrandIds: Array.isArray(updatedUser.assignedBrandIds) ? updatedUser.assignedBrandIds : [],
              assignedCompanyIds: Array.isArray(updatedUser.assignedCompanyIds) ? updatedUser.assignedCompanyIds : []
            });
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    try {
      emitBrandUpserted(formatBrand(created.toObject()));
    } catch (emitError) {
      console.error('emitBrandUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
    }

    res.status(201).json({ success: true, data: formatBrand(created.toObject()) });
  } catch (error) {
    console.error('Error creating brand:', error);
    res.status(500).json({ success: false, message: 'Failed to create brand' });
  }
};

exports.bulkUpsertBrands = async (req, res) => {
  try {
    const ownerId = (req.user?._id || req.user?.id || '').toString();
    if (!mongoose.Types.ObjectId.isValid(ownerId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const shouldAutoAssignCreator = req.body?.autoAssignCreator === false ? false : true;

    const inputBrands = Array.isArray(req.body?.brands) ? req.body.brands : [];
    if (!inputBrands.length) {
      return res.status(400).json({ success: false, message: 'brands array is required' });
    }

    const defaultRmEmail = req.body?.rmEmail;
    const defaultAmEmail = req.body?.amEmail;

    const normalizedInputsRaw = inputBrands
      .map((raw) => {
        const payload = buildBrandPayload(raw);
        const clientId = raw?.id || raw?.clientId || '';
        const rmEmail = raw?.rmEmail || defaultRmEmail;
        const amEmail = raw?.amEmail || defaultAmEmail;
        if (!payload?.name) return null;
        if (!payload?.company) return null;
        return { payload, clientId, rmEmail, amEmail };
      })
      .filter(Boolean);

    if (normalizedInputsRaw.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // Dedupe within the same request to avoid multiple bulkWrite ops for the same unique key.
    // Unique key is (owner, company, name, groupNumber).
    const uniqByKey = new Map();
    const normalizedInputs = [];
    for (const row of normalizedInputsRaw) {
      const groupKey = normalizeText(row?.payload?.groupNumber);
      const k = `${normalizeText(row.payload.company)}::${normalizeText(row.payload.name)}::${groupKey}`;
      if (!uniqByKey.has(k)) normalizedInputs.push(row);
      // keep the last row values (rm/am/groupNumber) for a repeated brand row
      uniqByKey.set(k, row);
    }
    const normalizedInputsUnique = Array.from(uniqByKey.values());

    const ops = [];
    const keysByCompany = new Map();
    const uniqueRmEmails = new Set();
    const uniqueAmEmails = new Set();

    for (const row of normalizedInputsUnique) {
      const payload = row.payload;
      const companyKey = normalizeText(payload.company);
      const nameKey = normalizeString(payload.name);
      const groupKey = normalizeText(payload.groupNumber);

      if (!keysByCompany.has(companyKey)) keysByCompany.set(companyKey, new Set());
      keysByCompany.get(companyKey).add(`${nameKey}::${groupKey}`);

      const rmKey = normalizeEmail(row.rmEmail);
      const amKey = normalizeEmail(row.amEmail);
      if (rmKey) uniqueRmEmails.add(rmKey);
      if (amKey) uniqueAmEmails.add(amKey);

      ops.push({
        updateOne: {
          filter: { owner: ownerId, name: payload.name, company: payload.company, groupNumber: payload.groupNumber || '' },
          update: {
            $set: {
              ...payload,
              owner: ownerId
            },
            $setOnInsert: {
              collaborators: [],
              history: [
                {
                  action: 'brand_created',
                  message: `Brand created: ${payload.name}`,
                  userId: ownerId,
                  userName: req.user?.name || 'Unknown',
                  userEmail: normalizeEmail(req.user?.email),
                  userRole: req.user?.role || 'user',
                  timestamp: new Date(),
                  metadata: { name: payload.name, company: payload.company }
                }
              ]
            }
          },
          upsert: true
        }
      });
    }

    try {
      await Brand.bulkWrite(ops, { ordered: false });
    } catch (e) {
      const code = e?.code;
      const name = e?.name;

      // With ordered:false Mongo can still throw when some ops fail (e.g., dup key races).
      // We can proceed because successful ops are already applied.
      if (code === 11000 || name === 'BulkWriteError') {
        try {
          console.warn('[brands/bulk] bulkWrite partial failure (continuing):', e?.message || e);
        } catch {
          // ignore
        }
      } else {
        throw e;
      }
    }

    const companyOr = [];
    for (const [companyKey, tupleKeys] of keysByCompany.entries()) {
      const tuples = Array.from(tupleKeys);
      for (const tuple of tuples) {
        const [name, groupNumber] = String(tuple || '').split('::');
        if (!name) continue;
        companyOr.push({
          company: { $regex: `^${escapeRegex(companyKey)}$`, $options: 'i' },
          name,
          groupNumber: groupNumber || ''
        });
      }
    }

    const docsAll = companyOr.length > 0
      ? await Brand.find({
        owner: ownerId,
        $or: companyOr
      })
        .collation({ locale: 'en', strength: 2 })
        .lean()
      : [];

    const byKey = new Map(
      (docsAll || []).map((d) => {
        const k = `${normalizeText(d?.company)}::${normalizeText(d?.name)}::${normalizeText(d?.groupNumber)}`;
        return [k, d];
      })
    );

    const results = normalizedInputsUnique
      .map((row) => {
        const k = `${normalizeText(row.payload.company)}::${normalizeText(row.payload.name)}::${normalizeText(row?.payload?.groupNumber)}`;
        const doc = byKey.get(k);
        if (!doc) return null;
        return { clientId: row.clientId, ...formatBrand(doc) };
      })
      .filter(Boolean);

    const upsertedBrandIds = new Set(
      (docsAll || [])
        .map((d) => (d?._id ? d._id.toString() : ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    );

    const assignmentMeta = {
      rmAmEmailCount: 0,
      rmAmUsersFound: 0,
      assignedBrandIdsOps: 0,
      mappingOps: 0
    };

    // Batch-assign assignedBrandIds + create UserBrandTaskType mappings for RM/AM based on per-row rmEmail/amEmail.
    // This makes the assignment show up in the Assign page even if the frontend mapping step fails.
    try {
      const emailToBrandIds = new Map();
      const emailToBrandMeta = new Map();

      const companyKeyToRaw = new Map();
      for (const row of normalizedInputsUnique) {
        const companyRaw = normalizeString(row?.payload?.company);
        const companyKey = normalizeText(companyRaw);
        if (companyKey && !companyKeyToRaw.has(companyKey)) companyKeyToRaw.set(companyKey, companyRaw);
      }

      const canonicalCompanyByKey = new Map(
        (await Promise.all(
          Array.from(companyKeyToRaw.entries()).map(async ([companyKey, companyRaw]) => {
            const canonical = await resolveCanonicalCompanyName(companyRaw);
            return [companyKey, canonical];
          })
        ))
      );

      const defaultTaskTypeIdsByCompanyKey = new Map();

      // Fetch CompanyBrandTaskType rows for all companies in one query (case-insensitive exact match via regex).
      const canonicalCompanies = Array.from(new Set(Array.from(canonicalCompanyByKey.values()).filter(Boolean)));
      let companyBrandTaskTypeRows = [];
      try {
        if (canonicalCompanies.length > 0) {
          companyBrandTaskTypeRows = await CompanyBrandTaskType.find({
            $or: canonicalCompanies.map((c) => ({
              companyName: { $regex: `^${escapeRegex(c)}$`, $options: 'i' }
            }))
          })
            .select('companyName taskTypeIds')
            .lean();
        }
      } catch {
        companyBrandTaskTypeRows = [];
      }

      const idsByCanonicalCompanyKey = new Map();
      for (const row of (companyBrandTaskTypeRows || [])) {
        const companyKey = normalizeText(row?.companyName);
        if (!companyKey) continue;
        if (!idsByCanonicalCompanyKey.has(companyKey)) idsByCanonicalCompanyKey.set(companyKey, new Set());
        const set = idsByCanonicalCompanyKey.get(companyKey);
        (Array.isArray(row?.taskTypeIds) ? row.taskTypeIds : [])
          .map((id) => (id ? id.toString() : ''))
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .forEach((id) => set.add(id));
      }

      const missingFallbackCompanies = [];
      for (const [companyKey, canonicalCompany] of canonicalCompanyByKey.entries()) {
        const canonicalKey = normalizeText(canonicalCompany);
        const set = canonicalKey ? idsByCanonicalCompanyKey.get(canonicalKey) : null;
        const ids = set ? Array.from(set) : [];
        if (ids.length > 0) {
          defaultTaskTypeIdsByCompanyKey.set(companyKey, ids);
        } else {
          missingFallbackCompanies.push([companyKey, canonicalCompany]);
        }
      }

      // Fallback only for companies missing CompanyBrandTaskType rows.
      if (missingFallbackCompanies.length > 0) {
        await Promise.all(missingFallbackCompanies.map(async ([companyKey, canonicalCompany]) => {
          try {
            let fallbackIds = [];
            try {
              const companyDoc = await Company.findOne({
                name: { $regex: `^${escapeRegex(canonicalCompany)}$`, $options: 'i' },
                isDeleted: { $ne: true }
              })
                .select('_id')
                .lean();
              const companyId = companyDoc?._id ? companyDoc._id.toString() : '';
              if (mongoose.Types.ObjectId.isValid(companyId)) {
                const types = await TaskType.find({ companyId, isActive: true })
                  .select('_id')
                  .lean();
                fallbackIds = (types || [])
                  .map((t) => (t?._id ? t._id.toString() : ''))
                  .filter((id) => mongoose.Types.ObjectId.isValid(id));
              }
            } catch {
              // ignore fallback errors
            }
            defaultTaskTypeIdsByCompanyKey.set(companyKey, fallbackIds);
          } catch {
            defaultTaskTypeIdsByCompanyKey.set(companyKey, []);
          }
        }));
      }

      for (const row of normalizedInputsUnique) {
        const k = `${normalizeText(row.payload.company)}::${normalizeText(row.payload.name)}::${normalizeText(row?.payload?.groupNumber)}`;
        const doc = byKey.get(k);
        const brandId = doc?._id ? doc._id.toString() : '';
        if (!mongoose.Types.ObjectId.isValid(brandId)) continue;

        const companyRaw = normalizeString(row?.payload?.company);
        const companyKey = normalizeText(companyRaw);
        const canonicalCompanyName = canonicalCompanyByKey.get(companyKey) || companyRaw;
        const defaultTaskTypeIds = defaultTaskTypeIdsByCompanyKey.get(companyKey) || [];

        const rmKey = normalizeEmail(row.rmEmail);
        const amKey = normalizeEmail(row.amEmail);
        const emails = [rmKey, amKey].filter(Boolean);
        for (const email of emails) {
          if (!emailToBrandIds.has(email)) emailToBrandIds.set(email, new Set());
          emailToBrandIds.get(email).add(brandId);

          if (!emailToBrandMeta.has(email)) emailToBrandMeta.set(email, []);
          emailToBrandMeta.get(email).push({
            companyName: canonicalCompanyName,
            brandId,
            brandName: normalizeString(doc?.name || row?.payload?.name),
            taskTypeIds: defaultTaskTypeIds
          });
        }
      }

      const emails = Array.from(emailToBrandIds.keys());
      assignmentMeta.rmAmEmailCount = emails.length;
      if (emails.length > 0) {
        const users = await User.find(buildEmailMatchQuery(emails)).select('_id email').lean();

        assignmentMeta.rmAmUsersFound = Array.isArray(users) ? users.length : 0;

        try {

          if (process.env.NODE_ENV !== 'production') {
            console.log('[brands/bulk] rm/am emails:', emails.length, 'users found:', Array.isArray(users) ? users.length : 0);
          }

        } catch {

          // ignore

        }

        const userByEmail = new Map((users || []).map((u) => [normalizeEmail(u?.email), u]));

        const userOps = [];
        for (const [email, brandIdsSet] of emailToBrandIds.entries()) {
          const u = userByEmail.get(email);
          const uid = u?._id ? u._id.toString() : '';
          if (!mongoose.Types.ObjectId.isValid(uid)) continue;
          const brandIds = Array.from(brandIdsSet).filter((id) => mongoose.Types.ObjectId.isValid(id));
          if (brandIds.length === 0) continue;
          userOps.push({
            updateOne: {
              filter: { _id: uid },
              update: { $addToSet: { assignedBrandIds: { $each: brandIds } } }
            }
          });
        }

        if (userOps.length > 0) {
          const userBatchSize = 500;
          for (let i = 0; i < userOps.length; i += userBatchSize) {
            const batch = userOps.slice(i, i + userBatchSize);
            if (batch.length === 0) continue;
            await User.bulkWrite(batch, { ordered: false });
          }

          assignmentMeta.assignedBrandIdsOps = userOps.length;
        }

        // Also upsert mapping rows (brand-taskTypeIds) for those users.
        // If defaultTaskTypeIds is empty for a company, we skip mapping upserts (same as frontend behavior).
        const mappingOps = [];
        for (const [email, rows] of emailToBrandMeta.entries()) {
          const u = userByEmail.get(email);
          const uid = u?._id ? u._id.toString() : '';
          if (!mongoose.Types.ObjectId.isValid(uid)) continue;

          const safeRows = Array.isArray(rows) ? rows : [];
          for (const r of safeRows) {
            if (!mongoose.Types.ObjectId.isValid(r?.brandId)) continue;
            if (!Array.isArray(r?.taskTypeIds) || r.taskTypeIds.length === 0) continue;

            mappingOps.push({
              updateOne: {
                filter: { companyName: r.companyName, userId: uid, brandId: r.brandId },
                update: {
                  $set: {
                    companyName: r.companyName,
                    userId: uid,
                    brandId: r.brandId,
                    brandName: normalizeString(r.brandName),
                    taskTypeIds: r.taskTypeIds,
                    updatedBy: ownerId
                  },
                  $setOnInsert: { createdBy: ownerId }
                },
                upsert: true
              }
            });
          }
        }

        if (mappingOps.length > 0) {
          try {
            const mappingBatchSize = 500;
            for (let i = 0; i < mappingOps.length; i += mappingBatchSize) {
              const batch = mappingOps.slice(i, i + mappingBatchSize);
              if (batch.length === 0) continue;
              await UserBrandTaskType.bulkWrite(batch, { ordered: false });
            }

            assignmentMeta.mappingOps = mappingOps.length;

            try {

              if (process.env.NODE_ENV !== 'production') {
                console.log('[brands/bulk] mapping upserted:', mappingOps.length);
              }

            } catch {

              // ignore

            }

          } catch (e) {
            try {
              console.warn('[brands/bulk] mapping bulkWrite failed (ignored):', e?.message || e);
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore assignment errors
    }

    // Emit upsert events for affected brands (best-effort).
    try {
      (docsAll || []).forEach((doc) => {
        try {
          emitBrandUpserted(formatBrand(doc));
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }

    if (shouldAutoAssignCreator && upsertedBrandIds.size > 0) {
      try {
        const updatedUser = await User.findByIdAndUpdate(ownerId, {
          $addToSet: { assignedBrandIds: { $each: Array.from(upsertedBrandIds) } }
        }, { new: true }).lean();
        if (updatedUser?._id) {
          try {
            emitUserUpserted({
              ...updatedUser,
              id: updatedUser._id,
              assignedBrandIds: Array.isArray(updatedUser.assignedBrandIds) ? updatedUser.assignedBrandIds : [],
              assignedCompanyIds: Array.isArray(updatedUser.assignedCompanyIds) ? updatedUser.assignedCompanyIds : []
            });
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    res.status(200).json({ success: true, data: results, meta: { assignment: assignmentMeta } });
  } catch (error) {
    console.error('Error bulk upserting brands:', error);
    const msg = error?.message || 'Failed to bulk upsert brands';
    res.status(500).json({ success: false, message: msg });
  }
};

exports.getUserBrands = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    const user = req.user;
    const requesterEmail = normalizeEmail(user?.email);

    const brands = await Brand.find({
      $or: [
        { owner: userId },
        { 'collaborators.email': requesterEmail, 'collaborators.status': { $in: ['accepted', 'active'] } }
      ]
    })
      .populate('owner', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const formatted = brands.map(b => ({
      ...b,
      id: b._id
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error fetching brands:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch brands' });
  }
};

exports.getBrandDetails = async (req, res) => {
  try {
    const { brandId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(brandId)) {
      return res.status(400).json({ success: false, message: 'Invalid brandId' });
    }

    const brand = await Brand.findById(brandId).populate('owner', 'name email').lean();

    if (!brand) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }

    const user = await withAssignedBrandIds(req.user);
    if (!userCanAccessBrand(brand, user)) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this brand' });
    }

    const rawTasks = await Task.find({
      $or: [
        { brandId: brand._id },
        { brand: brand.name },
        { companyName: brand.company },
        { company: brand.company }
      ]
    })
      .sort({ createdAt: -1 })
      .lean();

    const tasks = await withTaskHistory(rawTasks);

    const collaborators = brand.collaborators || [];
    const activeCollaborators = collaborators.filter(c => c.status === 'accepted').length;
    const pendingInvites = collaborators.filter(c => c.status === 'pending').length;

    res.json({
      success: true,
      data: {
        brand: { ...brand, id: brand._id },
        tasks: tasks.map(t => ({ ...t, id: t._id })),
        stats: {
          ...computeTaskStats(tasks),
          collaboratorsCount: collaborators.length,
          activeCollaborators,
          pendingInvites
        }
      }
    });
  } catch (error) {
    console.error('Error fetching brand details:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch brand details' });
  }
};

exports.inviteCollaborator = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { email, role, message } = req.body;

    if (!mongoose.Types.ObjectId.isValid(brandId)) {
      return res.status(400).json({ success: false, message: 'Invalid brandId' });
    }

    const inviteEmail = normalizeEmail(email);

    if (!inviteEmail) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const brand = await Brand.findById(brandId);

    if (!brand) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }

    const requesterId = (req.user?.id || req.user?._id || '').toString();
    const isOwner = brand.owner.toString() === requesterId;
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ success: false, message: 'Only owner/admin can invite collaborators' });
    }

    const already = (brand.collaborators || []).some(c => normalizeEmail(c.email) === inviteEmail);
    if (already) {
      return res.status(400).json({ success: false, message: 'User already invited/exists in collaborators' });
    }

    const userDoc = await User.findOne({ email: inviteEmail }).lean();

    brand.collaborators.push({
      userId: userDoc?._id || null,
      email: inviteEmail,
      name: userDoc?.name || inviteEmail.split('@')[0] || '',
      role: role || 'member',
      status: 'pending',
      invitedAt: new Date(),
      invitedBy: normalizeEmail(req.user?.email)
    });

    brand.history.push({
      action: 'collaborator_invited',
      message: `Invitation sent to ${inviteEmail} for ${(role || 'member')} role`,
      userId: requesterId,
      userName: req.user?.name || 'Unknown',
      userEmail: normalizeEmail(req.user?.email),
      userRole: req.user?.role || 'user',
      timestamp: new Date(),
      metadata: {
        email: inviteEmail,
        role: role || 'member',
        message: message || ''
      }
    });

    await brand.save();

    res.json({
      success: true,
      message: 'Invitation created successfully',
      data: { ...brand.toObject(), id: brand._id }
    });
  } catch (error) {
    console.error('Error inviting collaborator:', error);
    res.status(500).json({ success: false, message: 'Failed to invite collaborator', error: error.message });
  }
};

exports.respondToInvite = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { action } = req.body;

    if (!mongoose.Types.ObjectId.isValid(brandId)) {
      return res.status(400).json({ success: false, message: 'Invalid brandId' });
    }

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be accept or decline' });
    }

    const brand = await Brand.findById(brandId);
    if (!brand) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }

    const userEmail = normalizeEmail(req.user?.email);
    const collab = (brand.collaborators || []).find(c => normalizeEmail(c.email) === userEmail);

    if (!collab) {
      return res.status(404).json({ success: false, message: 'Invite not found for this user' });
    }

    if (collab.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Invite already ${collab.status}` });
    }

    if (action === 'accept') {
      collab.status = 'accepted';
      collab.joinedAt = new Date();
      collab.userId = req.user?.id || req.user?._id || collab.userId;
    } else {
      collab.status = 'declined';
    }

    brand.history.push({
      action: action === 'accept' ? 'collaborator_accepted' : 'collaborator_declined',
      message: action === 'accept' ? `${userEmail} accepted the invite` : `${userEmail} declined the invite`,
      userId: (req.user?.id || req.user?._id || '').toString(),
      userName: req.user?.name || 'Unknown',
      userEmail,
      userRole: req.user?.role || 'user',
      timestamp: new Date(),
      metadata: { email: userEmail }
    });

    await brand.save();

    res.json({
      success: true,
      message: action === 'accept' ? 'Invite accepted' : 'Invite declined',
      data: { ...brand.toObject(), id: brand._id }
    });
  } catch (error) {
    console.error('Error responding to invite:', error);
    res.status(500).json({ success: false, message: 'Failed to respond to invite', error: error.message });
  }
};

exports.getBrands = async (req, res) => {
  try {
    const user = await withAssignedBrandIds(req.user);
    const requesterEmail = normalizeEmail(user?.email);
    const role = String(user?.role || '').toLowerCase();
    const requesterId = (user?.id || user?._id || '').toString();

    const pageRaw = Number(req.query?.page);
    const limitRaw = Number(req.query?.limit);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 0;

    let query = {};

    const requestedCompany = normalizeString(req.query.company);
    const wantsCompanyFilter = requestedCompany && requestedCompany !== 'all';
    let allowCompanyWideForAssignment = false;
    if (
      wantsCompanyFilter &&
      requesterId &&
      mongoose.Types.ObjectId.isValid(requesterId) &&
      role !== 'admin' &&
      role !== 'super_admin' &&
      role !== 'md_manager' &&
      role !== 'rm' &&
      role !== 'am' &&
      role !== 'sales_manager' &&
      role !== 'sales_man'
    ) {
      try {
        const assignPerm = await getEffectivePermissionForUser(requesterId, 'assign_page');
        const brandAssignPerm = await getEffectivePermissionForUser(requesterId, 'brand_assign');
        allowCompanyWideForAssignment =
          String(assignPerm || '').toLowerCase() !== 'deny' || String(brandAssignPerm || '').toLowerCase() !== 'deny';
      } catch {
        allowCompanyWideForAssignment = false;
      }
    }

    if (role === 'admin' || role === 'super_admin') {
      query = {};
    } else if (role === 'md_manager') {
      const allowedCompanies = Array.isArray(user?.allowedCompanyNames) ? user.allowedCompanyNames : await resolveAllowedCompanyNamesForUser(user);
      if (allowedCompanies.length === 0) {
        return res.status(200).json({ success: true, data: [], total: 0 });
      }
      query = {
        $or: allowedCompanies.map((name) => ({
          company: { $regex: `^${escapeRegex(name)}$`, $options: 'i' }
        }))
      };
    } else if (allowCompanyWideForAssignment) {
      query = {};
    } else if (role === 'manager') {
      const assignedBrandIds = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds : [];
      query = {
        $or: [
          { _id: { $in: assignedBrandIds } },
          { owner: requesterId },
          { 'collaborators.email': requesterEmail, 'collaborators.status': { $in: ['accepted', 'active'] } }
        ]
      };
    } else if (role === 'assistant' || role === 'sbm' || role === 'rm' || role === 'am' || role === 'sales_manager' || role === 'sales_man') {
      const assignedBrandIds = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds : [];
      const userCompany = normalizeString(user.companyName || user.company);
      const isSalesRole = role === 'sales_manager' || role === 'sales_man';

      const companyOr = [];
      if (userCompany) {
        companyOr.push({ company: { $regex: `^${escapeRegex(userCompany)}$`, $options: 'i' } });
      }
      if (isSalesRole) {
        companyOr.push({ company: { $regex: '^Speed\\s*E\\s*Com$', $options: 'i' } });
      }

      query = companyOr.length > 0
        ? { $or: [{ _id: { $in: assignedBrandIds } }, ...companyOr] }
        : { _id: { $in: assignedBrandIds } };
    } else {
      query = {
        $or: [
          { owner: requesterId },
          {
            'collaborators.email': requesterEmail,
            'collaborators.status': { $in: ['accepted', 'active'] }
          }
        ]
      };
    }

    // Apply filters from query params
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      query = {
        $and: [
          query,
          {
            $or: [
              { name: searchRegex },
              { company: searchRegex },
              { groupNumber: searchRegex },
              { groupName: searchRegex }
            ]
          }
        ]
      };
    }

    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }

    if (req.query.company && req.query.company !== 'all') {
      const company = normalizeString(req.query.company);
      query.company = { $regex: `^${escapeRegex(company)}$`, $options: 'i' };
    }

    const includeDeleted = String(req.query?.includeDeleted || '').toLowerCase() === 'true';

    const baseQuery = Brand.find(query)
      .setOptions(includeDeleted ? { includeDeleted: true } : {})
      .populate('owner', 'name email')
      .sort({ createdAt: -1 });

    const [brands, total] = await Promise.all([
      (page && limit) ? baseQuery.skip((page - 1) * limit).limit(limit).lean() : baseQuery.lean(),
      Brand.countDocuments(query)
    ]);

    // Format response
    const formattedBrands = brands.map(brand => ({
      ...brand,
      id: brand._id
    }));

    res.status(200).json({
      success: true,
      data: formattedBrands,
      total,
      page: page || 1,
      limit: limit || formattedBrands.length
    });

  } catch (error) {
    console.error('Error fetching brands:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch brands',
      error: error.message
    });
  }
};

// Get brands assigned to user for task creation (no brands_page permission required)
exports.getAssignedBrands = async (req, res) => {
  try {
    const user = await withAssignedBrandIds(req.user);
    const requesterEmail = normalizeEmail(user?.email);
    const role = String(user?.role || '').toLowerCase();
    const requesterId = (user?.id || user?._id || '').toString();

    const pageRaw = Number(req.query?.page);
    const limitRaw = Number(req.query?.limit);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 0;

    let query = {};

    if (role === 'admin' || role === 'super_admin') {
      // Admins can see all brands for task creation
      query = {};
    } else if (role === 'md_manager') {
      const allowedCompanies = Array.isArray(user?.allowedCompanyNames) ? user.allowedCompanyNames : await resolveAllowedCompanyNamesForUser(user);
      if (allowedCompanies.length === 0) {
        return res.status(200).json({ success: true, data: [], total: 0 });
      }
      query = {
        $or: allowedCompanies.map((name) => ({
          company: { $regex: `^${escapeRegex(name)}$`, $options: 'i' }
        }))
      };
    } else if (role === 'manager') {
      // Managers can see their own brands and assigned brands
      const assignedBrandIds = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds : [];
      query = {
        $or: [
          { _id: { $in: assignedBrandIds } },
          { owner: requesterId },
          { 'collaborators.email': requesterEmail, 'collaborators.status': { $in: ['accepted', 'active'] } }
        ]
      };
    } else if (role === 'assistant' || role === 'sbm' || role === 'rm' || role === 'am' || role === 'sales_manager' || role === 'sales_man') {
      // Assistants, SBM, RM, AM, Sales Manager, Sales Man can see assigned brands and brands of their company
      const assignedBrandIds = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds : [];
      const userCompany = normalizeString(user.companyName || user.company);

      const companyQuery = userCompany 
        ? { company: { $regex: `^${escapeRegex(userCompany)}$`, $options: 'i' } } 
        : null;

      query = companyQuery 
        ? { $or: [{ _id: { $in: assignedBrandIds } }, companyQuery] }
        : { _id: { $in: assignedBrandIds } };
    } else {
      // Other users can see their own brands and accepted collaborator brands
      query = {
        $or: [
          { owner: requesterId },
          {
            'collaborators.email': requesterEmail,
            'collaborators.status': { $in: ['accepted', 'active'] }
          }
        ]
      };
    }

    // Only show active brands (not deleted)
    query.isDeleted = { $ne: true };

    const baseQuery = Brand.find(query)
      .select('name company status owner _id groupNumber groupName')
      .populate('owner', 'name email')
      .sort({ name: 1 });

    const [brands, total] = await Promise.all([
      (page && limit) ? baseQuery.skip((page - 1) * limit).limit(limit).lean() : baseQuery.lean(),
      Brand.countDocuments(query)
    ]);

    // Format response with assignment info
    const formattedBrands = brands.map(brand => {
      const isOwner = brand.owner && brand.owner._id && 
        brand.owner._id.toString() === requesterId;
      const isAssigned = Array.isArray(user.assignedBrandIds) && 
        user.assignedBrandIds.some(id => id.toString() === brand._id.toString());
      
      return {
        ...brand,
        id: brand._id,
        assignmentType: isOwner ? 'owner' : (isAssigned ? 'assigned' : 'collaborator'),
        assignedBy: isAssigned ? 'admin' : (isOwner ? 'self' : 'manager')
      };
    });

    res.status(200).json({
      success: true,
      data: formattedBrands,
      total,
      page: page || 1,
      limit: limit || formattedBrands.length
    });

  } catch (error) {
    console.error('Error fetching assigned brands:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assigned brands',
      error: error.message
    });
  }
};

// ✅ getBrandById function add करें
exports.getBrandById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid brand ID'
      });
    }

    const brand = await Brand.findOne({ _id: id }).setOptions({ includeDeleted: true })
      .populate('owner', 'name email')
      .populate('collaborators.userId', 'name email role')
      .lean();

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Check if user has access
    const user = await withAssignedBrandIds(req.user);
    if (!userCanAccessBrand(brand, user)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this brand'
      });
    }

    // Get tasks for this brand
    const rawTasks = await Task.find({
      $or: [
        { brandId: brand._id },
        { brand: brand.name },
        { companyName: brand.company }
      ]
    })
      .lean();

    const tasks = await withTaskHistory(rawTasks);

    // Calculate stats
    const stats = computeTaskStats(tasks);

    res.status(200).json({
      success: true,
      data: {
        ...brand,
        id: brand._id,
        tasks: tasks.map(task => ({
          ...task,
          id: task._id
        })),
        stats
      }
    });

  } catch (error) {
    console.error('Error fetching brand by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch brand',
      error: error.message
    });
  }
};

// ✅ updateBrand function add करें
exports.updateBrand = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req.user?.id || req.user?._id || '').toString();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid brand ID'
      });
    }

    const brand = await Brand.findOne({ _id: id }).setOptions({ includeDeleted: true });

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Check authorization
    const isOwner = brand.owner.toString() === userId;
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update brand'
      });
    }

    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

    const updates = {};
    if (hasOwn(req.body, 'name')) updates.name = normalizeString(req.body?.name);
    if (hasOwn(req.body, 'company')) updates.company = normalizeString(req.body?.company);
    if (hasOwn(req.body, 'category')) updates.category = normalizeString(req.body?.category) || 'Other';
    if (hasOwn(req.body, 'website')) updates.website = normalizeString(req.body?.website);
    if (hasOwn(req.body, 'logo')) updates.logo = req.body?.logo ? req.body.logo.toString() : '';
    if (hasOwn(req.body, 'status')) updates.status = normalizeString(req.body?.status) || brand.status;

    if (hasOwn(req.body, 'name') && !updates.name) {
      return res.status(400).json({
        success: false,
        message: 'Brand name is required'
      });
    }

    const before = {
      name: brand.name,
      company: brand.company,
      category: brand.category,
      website: brand.website,
      logo: brand.logo,
      status: brand.status
    };

    // Update only fields provided by client
    if (hasOwn(updates, 'name')) brand.name = updates.name;
    if (hasOwn(updates, 'company')) brand.company = updates.company;
    if (hasOwn(updates, 'category')) brand.category = updates.category;
    if (hasOwn(updates, 'website')) brand.website = updates.website;
    if (hasOwn(updates, 'logo')) brand.logo = updates.logo;
    if (hasOwn(updates, 'status')) brand.status = updates.status;

    const after = {
      name: brand.name,
      company: brand.company,
      category: brand.category,
      website: brand.website,
      logo: brand.logo,
      status: brand.status
    };

    const actor = {
      userId: userId,
      userName: req.user?.name || 'Unknown',
      userEmail: normalizeEmail(req.user?.email),
      userRole: req.user?.role || 'user',
      performedBy: mongoose.Types.ObjectId.isValid(userId) ? userId : null,
      timestamp: new Date()
    };

    const changes = [];
    ['name', 'company', 'category', 'website', 'logo', 'status'].forEach((field) => {
      const oldValue = before[field];
      const newValue = after[field];
      if (String(oldValue ?? '') !== String(newValue ?? '')) {
        changes.push({ field, oldValue, newValue });
      }
    });

    if (changes.length === 0) {
      brand.history.push({
        action: 'brand_updated',
        message: 'Brand update attempted (no field changes)',
        ...actor,
        metadata: { id: String(brand._id), name: brand.name, company: brand.company }
      });
    } else {
      changes.forEach((c) => {
        const action = c.field === 'status' ? 'status_changed' : 'brand_updated';
        brand.history.push({
          action,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          message: `Updated ${c.field}`,
          ...actor,
          metadata: { id: String(brand._id), name: brand.name, company: brand.company }
        });
      });
    }

    await brand.save();

    try {
      emitBrandUpserted(formatBrand(brand.toObject()));
    } catch (emitError) {
      console.error('emitBrandUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
    }

    res.status(200).json({
      success: true,
      message: 'Brand updated successfully',
      data: formatBrand(brand.toObject())
    });

  } catch (error) {
    console.error('Error updating brand:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update brand',
      error: error.message
    });
  }
};

// ✅ deleteBrand function add करें
exports.deleteBrand = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req.user?.id || req.user?._id || '').toString();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid brand ID'
      });
    }

    const brand = await Brand.findById(id);

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Check authorization
    const isOwner = brand.owner.toString() === userId;
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete brand'
      });
    }

    // Check if brand has associated tasks
    const taskCount = await Task.countDocuments({
      $or: [
        { brandId: brand._id },
        { brand: brand.name }
      ]
    });

    if (taskCount > 0 && req.query.force !== 'true') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete brand with ${taskCount} associated tasks. Use force=true to delete anyway.`
      });
    }

    // Delete associated tasks if forced
    if (req.query.force === 'true' && taskCount > 0) {
      await Task.deleteMany({
        $or: [
          { brandId: brand._id },
          { brand: brand.name }
        ]
      });
    }

    // Add to history before deletion
    brand.history.push({
      action: 'brand_deleted',
      message: `Brand deleted: ${brand.name}`,
      userId: userId,
      userName: req.user?.name || 'Unknown',
      userEmail: normalizeEmail(req.user?.email),
      userRole: req.user?.role || 'user',
      timestamp: new Date(),
      metadata: {
        name: brand.name,
        company: brand.company
      }
    });

    // Save history log before deletion
    await brand.save();

    // Delete the brand
    await Brand.findByIdAndDelete(id);

    try {
      emitBrandDeleted({ brandId: brand?._id, companyName: brand?.company });
    } catch (emitError) {
      console.error('emitBrandDeleted failed:', emitError && emitError.message ? emitError.message : emitError);
    }

    res.status(200).json({
      success: true,
      message: 'Brand deleted successfully',
      data: {
        id: brand._id,
        name: brand.name,
        company: brand.company
      }
    });

  } catch (error) {
    console.error('Error deleting brand:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete brand',
      error: error.message
    });
  }
};

// Soft delete brand
exports.softDeleteBrand = async (req, res) => {
  try {
    const { id } = req.params;
    const reason = typeof req.body === 'string'
      ? req.body
      : (req.body && typeof req.body === 'object' ? req.body.reason : undefined);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid brand ID'
      });
    }

    const actorId = (req.user?.id || req.user?._id || '').toString();
    const actorObjectId = mongoose.Types.ObjectId.isValid(actorId) ? actorId : null;
    const role = String(req.user?.role || '').toLowerCase();

    const brand = await Brand.findOne({ _id: id }).setOptions({ includeDeleted: true });

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    if (brand.status === 'deleted' || brand.isDeleted === true) {
      return res.status(400).json({
        success: false,
        message: 'Brand is already deleted'
      });
    }

    // Check permissions
    if (brand.owner.toString() !== actorId && role !== 'admin' && role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this brand'
      });
    }

    // Soft delete the brand
    const deletedBrand = await Brand.softDelete(id, actorObjectId, reason);

    if (!deletedBrand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Add to history
    deletedBrand.history.push({
      action: 'brand_deleted',
      message: `Brand deleted: ${deletedBrand.name}`,
      performedBy: actorObjectId,
      userId: actorId,
      userName: req.user?.name || 'Unknown',
      userEmail: normalizeEmail(req.user?.email),
      userRole: req.user?.role || 'user',
      timestamp: new Date(),
      notes: reason || 'Brand deleted',
      metadata: {
        reason: reason || '',
        name: deletedBrand.name,
        company: deletedBrand.company
      }
    });

    await deletedBrand.save();

    try {
      emitBrandDeleted({ brandId: deletedBrand?._id, companyName: deletedBrand?.company });
    } catch (emitError) {
      console.error('emitBrandDeleted failed:', emitError && emitError.message ? emitError.message : emitError);
    }

    return res.json({
      success: true,
      message: 'Brand deleted successfully',
      data: deletedBrand
    });

  } catch (error) {
    console.error('Error deleting brand:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Restore deleted brand
exports.restoreBrand = async (req, res) => {
  try {
    const { id } = req.params;
    const actorId = (req.user?.id || req.user?._id || '').toString();
    const actorObjectId = mongoose.Types.ObjectId.isValid(actorId) ? actorId : null;
    
    // Only admin can restore
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can restore deleted brands'
      });
    }
    
    const brand = await Brand.findOne({ 
      _id: id,
      $or: [
        { status: 'deleted' },
        { isDeleted: true }
      ]
    });
    
    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Deleted brand not found'
      });
    }
    
    // Restore the brand
    const restoredBrand = await Brand.restore(id);

    if (!restoredBrand) {
      return res.status(404).json({
        success: false,
        message: 'Deleted brand not found'
      });
    }
    
    // Add to history
    restoredBrand.history.push({
      action: 'restored',
      message: `Brand restored: ${restoredBrand.name}`,
      performedBy: actorObjectId,
      userId: actorId,
      userName: req.user?.name || 'Unknown',
      userEmail: normalizeEmail(req.user?.email),
      userRole: req.user?.role || 'user',
      timestamp: new Date(),
      notes: 'Brand restored by admin',
      metadata: {
        name: restoredBrand.name,
        company: restoredBrand.company
      }
    });
    
    await restoredBrand.save();

    try {
      emitBrandUpserted(formatBrand(restoredBrand.toObject()));
    } catch (emitError) {
      console.error('emitBrandUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
    }
    
    res.json({
      success: true,
      message: 'Brand restored successfully',
      data: restoredBrand
    });
    
  } catch (error) {
    console.error('Error restoring brand:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Get deleted brands 
exports.getDeletedBrands = async (req, res) => {
  try {
    const deletedBrands = await Brand.findDeleted()
      .populate('owner', 'name email role')
      .populate('deletedBy', 'name email')
      .sort({ deletedAt: -1 });
    
    res.json({
      success: true,
      data: deletedBrands,
      total: deletedBrands.length
    });
    
  } catch (error) {
    console.error('Error fetching deleted brands:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Permanent delete (hard delete) - admin only
exports.hardDeleteBrand = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Only admin can hard delete
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can permanently delete brands'
      });
    }
    
    const brand = await Brand.findOne({ 
      _id: id,
      $or: [
        { status: 'deleted' },
        { isDeleted: true }
      ]
    });
    
    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Deleted brand not found'
      });
    }
    
    // Permanent delete
    await Brand.findByIdAndDelete(id);

    try {
      emitBrandDeleted({ brandId: brand?._id, companyName: brand?.company });
    } catch (emitError) {
      console.error('emitBrandDeleted failed:', emitError && emitError.message ? emitError.message : emitError);
    }
    
    res.json({
      success: true,
      message: 'Brand permanently deleted'
    });
    
  } catch (error) {
    console.error('Error hard deleting brand:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};