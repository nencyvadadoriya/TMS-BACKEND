const mongoose = require('mongoose');
const Brand = require('../model/Brand.model');
const Task = require('../model/Task.model');
const User = require('../model/user.model');
const TaskHistory = require('../model/TaskHistory.model');

const normalizeEmail = (email) => (email || '').toString().trim().toLowerCase();

const withAssignedBrandIds = async (user) => {
  try {
    const role = String(user?.role || '').toLowerCase();
    if (role !== 'manager' && role !== 'assistant') return user;

    if (Array.isArray(user?.assignedBrandIds) && user?.managerId) return user;

    const id = (user?.id || user?._id || '').toString();
    if (!mongoose.Types.ObjectId.isValid(id)) return user;

    const dbUser = await User.findById(id).select('assignedBrandIds managerId').lean();
    return {
      ...user,
      assignedBrandIds: Array.isArray(dbUser?.assignedBrandIds) ? dbUser.assignedBrandIds : [],
      managerId: user?.managerId || dbUser?.managerId || null
    };
  } catch {
    return user;
  }
};

const userCanAccessBrand = (brand, user) => {
  if (!brand || !user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin') return true;

  const userEmail = normalizeEmail(user.email);
  const assigned = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds.map(String) : [];

  const brandId = String(brand._id || brand.id || '');
  const hasAssignedAccess = brandId && assigned.includes(brandId);

  if (role === 'assistant') {
    return Boolean(hasAssignedAccess);
  }

  const isOwner = brand.owner && brand.owner.toString() === (user.id || user._id || '').toString();
  if (role === 'manager') {
    const isAcceptedCollaborator = (brand.collaborators || []).some(c => normalizeEmail(c.email) === userEmail && (c.status === 'accepted' || c.status === 'active'));
    return Boolean(isOwner || hasAssignedAccess || isAcceptedCollaborator);
  }

  const isAcceptedCollaborator = (brand.collaborators || []).some(c => normalizeEmail(c.email) === userEmail && (c.status === 'accepted' || c.status === 'active'));
  return Boolean(isOwner || isAcceptedCollaborator);
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

  return {
    name,
    company,
    category,
    website,
    logo,
    status
  };
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

    res.status(201).json({ success: true, data: formatBrand(created.toObject()) });
  } catch (error) {
    console.error('Error creating brand:', error);
    res.status(500).json({ success: false, message: 'Failed to create brand' });
  }
};

exports.bulkUpsertBrands = async (req, res) => {
  try {
    const ownerId = (req.user?.id || req.user?._id || '').toString();
    if (!mongoose.Types.ObjectId.isValid(ownerId)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const inputBrands = Array.isArray(req.body?.brands) ? req.body.brands : [];
    if (!inputBrands.length) {
      return res.status(400).json({ success: false, message: 'brands array is required' });
    }

    const results = [];

    for (const raw of inputBrands) {
      const payload = buildBrandPayload(raw);
      if (!payload.name) continue;

      const doc = await Brand.findOneAndUpdate(
        { owner: ownerId, name: payload.name, company: payload.company },
        {
          $set: {
            ...payload,
            owner: ownerId
          },
          $push: {
            history: {
              action: 'brand_updated',
              message: `Brand upserted: ${payload.name}`,
              userId: ownerId,
              userName: req.user?.name || 'Unknown',
              userEmail: normalizeEmail(req.user?.email),
              userRole: req.user?.role || 'user',
              timestamp: new Date(),
              metadata: { name: payload.name, company: payload.company, clientId: raw?.id || raw?.clientId || '' }
            }
          }
        },
        { new: true, upsert: true }
      );

      results.push({
        clientId: raw?.id || raw?.clientId || '',
        ...formatBrand(doc.toObject())
      });
    }

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error('Error bulk upserting brands:', error);
    res.status(500).json({ success: false, message: 'Failed to bulk upsert brands' });
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
    const isAdmin = req.user?.role === 'admin';

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

    let query = {};

    if (role === 'admin') {
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
    } else if (role === 'assistant') {
      const assignedBrandIds = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds : [];
      query = { _id: { $in: assignedBrandIds } };
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
              { company: searchRegex }
            ]
          }
        ]
      };
    }

    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }

    if (req.query.company && req.query.company !== 'all') {
      query.company = req.query.company;
    }

    // Execute query
    const brands = await Brand.find(query)
      .populate('owner', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    // Format response
    const formattedBrands = brands.map(brand => ({
      ...brand,
      id: brand._id
    }));

    res.status(200).json({
      success: true,
      data: formattedBrands,
      total: formattedBrands.length
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

    let query = {};

    if (role === 'admin') {
      // Admins can see all brands for task creation
      query = {};
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
    } else if (role === 'assistant') {
      // Assistants can only see assigned brands
      const assignedBrandIds = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds : [];
      query = { _id: { $in: assignedBrandIds } };
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

    // Execute query
    const brands = await Brand.find(query)
      .select('name company status owner _id')
      .populate('owner', 'name email')
      .sort({ name: 1 })
      .lean();

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
      total: formattedBrands.length
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
    const isAdmin = req.user?.role === 'admin';

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Only owner or admin can update brand'
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
    const isAdmin = req.user?.role === 'admin';

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Only owner or admin can delete brand'
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
    if (brand.owner.toString() !== actorId && role !== 'admin') {
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
    if (req.user.role !== 'admin') {
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
    if (req.user.role !== 'admin') {
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