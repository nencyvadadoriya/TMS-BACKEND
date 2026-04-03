const MdImpexAccess = require('../model/MdImpexAccess.model');
const PersonAccess = require('../model/PersonAccess.model');
const User = require('../model/user.model');
const Role = require('../model/Role.model');
const mongoose = require('mongoose');

const normalizeText = (v) => (v == null ? '' : String(v)).trim();
const normalizeEmail = (v) => normalizeText(v).toLowerCase();

const isObjectIdString = (v) => {
  const s = normalizeText(v);
  return Boolean(s) && mongoose.Types.ObjectId.isValid(s);
};

const resolveAllowedAssigneeIds = async (allowedAssignees) => {
  const list = Array.isArray(allowedAssignees) ? allowedAssignees : [];

  const ids = [];
  const emails = [];

  for (const a of list) {
    const raw = normalizeText(a);
    if (!raw) continue;
    if (isObjectIdString(raw)) {
      ids.push(raw);
    } else {
      const em = normalizeEmail(raw);
      if (em) emails.push(em);
    }
  }

  if (emails.length > 0) {
    const users = await User.find({ email: { $in: emails } }).select('_id email').lean();
    for (const u of users) {
      const id = u._id?.toString?.();
      if (id) ids.push(id);
    }
  }

  return Array.from(new Set(ids)).map((id) => new mongoose.Types.ObjectId(id));
};

// Get all MD Impex access roles with their emails
exports.getAllRoles = async (req, res) => {
  try {
    const { companyName } = req.query || {};
    const filterCompanyName = companyName && companyName.toLowerCase().includes('md impex')
      ? 'MD Impex'
      : 'MD Impex'; // Default to MD Impex

    const roles = await MdImpexAccess.find({ companyName: filterCompanyName })
      .populate('role', 'key name')
      .lean();

    // Filter out Speed E Com related roles
    const speedEComKeywords = ['speed', 'ecom', 'speed_ecom', 'speedecom', 'speed-ecom'];
    const filteredRoles = roles.filter(r => {
      const roleName = (r.role?.name || '').toLowerCase();
      const roleKey = (r.role?.key || '').toLowerCase();
      return !speedEComKeywords.some(keyword => roleName.includes(keyword) || roleKey.includes(keyword));
    });

    return res.status(200).json({
      success: true,
      data: filteredRoles.map(r => ({
        id: r._id?.toString?.() || r.id,
        role: r.role?.name || '',
        roleKey: r.role?.key || '',
        emails: r.emails || [],
        description: r.description || '',
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      })),
      message: 'Roles fetched successfully'
    });
  } catch (err) {
    console.error('[MdImpexAccess] getAllRoles error:', err);
    return res.status(500).json({
      success: false,
      data: [],
      message: err?.message || 'Failed to fetch roles'
    });
  }
};

// Get all MD Impex members (users with companyName containing "md" and "impex")
exports.getAllMembers = async (req, res) => {
  try {
    const { companyName } = req.query || {};

    let members = [];

    if (companyName && companyName.toLowerCase().includes('md impex')) {
      // Get users with companyName exactly "MD Impex" or similar variations
      members = await User.find({
        companyName: { $regex: /^\s*md\s*impex\s*$/i }
      }).select('email name role companyName').lean();
    } else {
      // Default: get MD Impex members
      members = await User.find({
        companyName: { $regex: /^\s*md\s*impex\s*$/i }
      }).select('email name role companyName').lean();
    }

    // Deduplicate by email
    const uniqueEmails = new Set();
    const uniqueMembers = [];

    for (const m of members) {
      const email = normalizeEmail(m.email);
      if (email && !uniqueEmails.has(email)) {
        uniqueEmails.add(email);
        uniqueMembers.push({
          id: m._id?.toString?.() || m.id,
          email: m.email,
          name: m.name || '',
          role: m.role || '',
          companyName: m.companyName || ''
        });
      }
    }

    // Sort by name
    uniqueMembers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return res.status(200).json({
      success: true,
      data: uniqueMembers,
      message: 'Members fetched successfully'
    });
  } catch (err) {
    console.error('[MdImpexAccess] getAllMembers error:', err);
    return res.status(500).json({
      success: false,
      data: [],
      message: err?.message || 'Failed to fetch members'
    });
  }
};

// Create a new role
exports.createRole = async (req, res) => {
  try {
    const { role, emails = [], description = '' } = req.body || {};

    if (!role || !normalizeText(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role name is required'
      });
    }

    const normalizedRole = normalizeText(role);
    const roleKey = normalizedRole.toLowerCase().replace(/\s+/g, '_');

    // Check if role already exists in Role model
    const existingRole = await Role.findOne({ key: roleKey });

    // Normalize emails
    const normalizedEmails = Array.isArray(emails)
      ? emails.map(e => normalizeEmail(e)).filter(e => e)
      : [];

    const createdBy = {
      id: req.user?.id || req.user?._id,
      name: req.user?.name,
      email: req.user?.email
    };

    let roleToUse = null;
    if (existingRole) {
      roleToUse = existingRole;
      // If an MdImpexAccess entry for this role+company already exists, return conflict
      const existingAccess = await MdImpexAccess.findOne({ role: existingRole._id, companyName: 'MD Impex' });
      if (existingAccess) {
        return res.status(409).json({
          success: false,
          message: `Role "${normalizedRole}" already exists for MD Impex`
        });
      }
    } else {
      // Create role in Role model
      roleToUse = await Role.create({
        key: roleKey,
        name: normalizedRole
      });
    }

    const newMdImpexAccess = await MdImpexAccess.create({
      role: roleToUse._id,
      emails: normalizedEmails,
      companyName: 'MD Impex',
      description: normalizeText(description),
      createdBy
    });

    return res.status(201).json({
      success: true,
      data: {
        id: newMdImpexAccess._id?.toString?.() || newMdImpexAccess.id,
        role: roleToUse.name,
        roleKey: roleToUse.key,
        emails: newMdImpexAccess.emails,
        description: newMdImpexAccess.description,
        createdAt: newMdImpexAccess.createdAt
      },
      message: 'Role created successfully'
    });
  } catch (err) {
    console.error('[MdImpexAccess] createRole error:', err);
    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to create role'
    });
  }
};

// Update role emails
exports.updateRoleEmails = async (req, res) => {
  try {
    const { id } = req.params;
    const { emails = [] } = req.body || {};

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Role ID is required'
      });
    }

    // Normalize emails
    const normalizedEmails = Array.isArray(emails)
      ? emails.map(e => normalizeEmail(e)).filter(e => e)
      : [];

    const updated = await MdImpexAccess.findByIdAndUpdate(
      id,
      {
        emails: normalizedEmails,
        $set: { updatedAt: new Date() }
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: updated._id?.toString?.() || updated.id,
        role: updated.role,
        emails: updated.emails,
        description: updated.description
      },
      message: 'Role emails updated successfully'
    });
  } catch (err) {
    console.error('[MdImpexAccess] updateRoleEmails error:', err);
    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to update role emails'
    });
  }
};

// Delete a role
exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Role ID is required'
      });
    }

    const deleted = await MdImpexAccess.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: `Role "${deleted.role}" deleted successfully`
    });
  } catch (err) {
    console.error('[MdImpexAccess] deleteRole error:', err);
    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to delete role'
    });
  }
};

// Get emails by role (for checking permissions)
exports.getEmailsByRole = async (req, res) => {
  try {
    const { role } = req.params;

    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Role is required'
      });
    }

    // Find role by key
    const roleDoc = await Role.findOne({ key: normalizeText(role).toLowerCase().replace(/\s+/g, '_') });
    if (!roleDoc) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    const access = await MdImpexAccess.findOne({
      role: roleDoc._id,
      companyName: 'MD Impex'
    }).lean();

    return res.status(200).json({
      success: true,
      data: {
        role: roleDoc.name,
        emails: access?.emails || []
      },
      message: 'Emails fetched successfully'
    });
  } catch (err) {
    console.error('[MdImpexAccess] getEmailsByRole error:', err);
    return res.status(500).json({
      success: false,
      data: { emails: [] },
      message: err?.message || 'Failed to fetch emails'
    });
  }
};

// Person-wise access CRUD operations

// Get all person-wise access records
exports.getAllPersonAccess = async (req, res) => {
  try {
    const personAccess = await PersonAccess.find({ companyName: 'MD Impex' })
      .populate('createdBy', 'name email')
      .populate('accessRole', 'key name')
      .lean();

    return res.status(200).json({
      success: true,
      data: personAccess.map(p => ({
        id: p._id?.toString?.() || p.id,
        assignedToEmail: p.assignedToEmail,
        assignedToName: p.assignedToName,
        assignedToRole: p.assignedToRole,
        accessRole: p.accessRole?.name || '',
        accessRoleKey: p.accessRole?.key || '',
        allowedAssignees: (p.allowedAssignees || []).map((v) => v?.toString?.() || String(v)),
        allowedTaskTypes: Array.isArray(p.allowedTaskTypes) ? p.allowedTaskTypes : [],
        allowedBrands: Array.isArray(p.allowedBrands) ? p.allowedBrands : [],
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      })),
      message: 'Person access fetched successfully'
    });
  } catch (err) {
    console.error('[MdImpexAccess] getAllPersonAccess error:', err);
    return res.status(500).json({
      success: false,
      data: [],
      message: err?.message || 'Failed to fetch person access'
    });
  }
};

// Create person-wise access
exports.createPersonAccess = async (req, res) => {
  try {
    const {
      assignedToEmail,
      assignedToRole,
      accessRole,
      allowedAssignees = [],
      allowedTaskTypes = [],
      allowedBrands = []
    } = req.body || {};

    console.log('[DEBUG] createPersonAccess received:', { assignedToEmail, assignedToRole, accessRole, allowedAssignees, allowedTaskTypes });

    if (!assignedToEmail) {
      return res.status(400).json({
        success: false,
        message: 'Assigned person email is required'
      });
    }

    // Get user details for assignedToEmail
    const assignedUser = await User.findOne({
      email: normalizeEmail(assignedToEmail)
    }).select('name email role').lean();

    if (!assignedUser) {
      return res.status(404).json({
        success: false,
        message: 'Assigned user not found'
      });
    }

    // Find role by key if accessRole provided
    let roleDoc = null;
    if (accessRole) {
      roleDoc = await Role.findOne({ key: normalizeText(accessRole).toLowerCase().replace(/\s+/g, '_') });
    }

    const resolvedAllowedAssigneeIds = await resolveAllowedAssigneeIds(allowedAssignees);

    const normalizedAllowedTaskTypes = Array.isArray(allowedTaskTypes)
      ? allowedTaskTypes.map((v) => normalizeText(v).toLowerCase()).filter(Boolean)
      : [];

    const normalizedAllowedBrands = Array.isArray(allowedBrands)
      ? allowedBrands.map((v) => normalizeText(v)).filter(Boolean)
      : [];

    const createdBy = {
      id: req.user?.id || req.user?._id,
      name: req.user?.name,
      email: req.user?.email
    };

    const newPersonAccess = await PersonAccess.create({
      assignedToEmail: normalizeEmail(assignedToEmail),
      assignedToName: assignedUser.name || '',
      assignedToRole: normalizeText(assignedToRole) || assignedUser.role || '',
      accessRole: roleDoc?._id || null,
      allowedAssignees: resolvedAllowedAssigneeIds,
      allowedTaskTypes: Array.from(new Set(normalizedAllowedTaskTypes)),
      allowedBrands: Array.from(new Set(normalizedAllowedBrands)),
      companyName: 'MD Impex',
      createdBy
    });

    return res.status(201).json({
      success: true,
      data: {
        id: newPersonAccess._id?.toString?.() || newPersonAccess.id,
        assignedToEmail: newPersonAccess.assignedToEmail,
        assignedToName: newPersonAccess.assignedToName,
        assignedToRole: newPersonAccess.assignedToRole,
        accessRole: roleDoc?.name || '',
        accessRoleKey: roleDoc?.key || '',
        allowedAssignees: (newPersonAccess.allowedAssignees || []).map((v) => v?.toString?.() || String(v)),
        allowedTaskTypes: Array.isArray(newPersonAccess.allowedTaskTypes) ? newPersonAccess.allowedTaskTypes : [],
        allowedBrands: Array.isArray(newPersonAccess.allowedBrands) ? newPersonAccess.allowedBrands : [],
        createdAt: newPersonAccess.createdAt
      },
      message: 'Person access created successfully'
    });
  } catch (err) {
    console.error('[MdImpexAccess] createPersonAccess error:', err);
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Person access for this role already exists'
      });
    }
    return res.status(500).json({
      success: false,
      data: null,
      message: err?.message || 'Failed to create person access'
    });
  }
};

// Update person-wise access
exports.updatePersonAccess = async (req, res) => {
  try {
    const { id } = req.params;
    const { accessRole, allowedAssignees = [], allowedTaskTypes = [], allowedBrands = [] } = req.body || {};

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Person access ID is required'
      });
    }

    const updateData = {};

    if (accessRole) {
      // Find role by key
      const roleDoc = await Role.findOne({ key: normalizeText(accessRole).toLowerCase().replace(/\s+/g, '_') });
      if (!roleDoc) {
        return res.status(404).json({
          success: false,
          message: 'Access role not found'
        });
      }
      updateData.accessRole = roleDoc._id;
    }

    const resolvedAllowedAssigneeIds = await resolveAllowedAssigneeIds(allowedAssignees);
    updateData.allowedAssignees = resolvedAllowedAssigneeIds;

    const normalizedAllowedTaskTypes = Array.isArray(allowedTaskTypes)
      ? allowedTaskTypes.map((v) => normalizeText(v).toLowerCase()).filter(Boolean)
      : [];
    updateData.allowedTaskTypes = Array.from(new Set(normalizedAllowedTaskTypes));

    const normalizedAllowedBrands = Array.isArray(allowedBrands)
      ? allowedBrands.map((v) => normalizeText(v)).filter(Boolean)
      : [];
    updateData.allowedBrands = Array.from(new Set(normalizedAllowedBrands));

    const updated = await PersonAccess.findByIdAndUpdate(
      id,
      {
        ...updateData,
        $set: { updatedAt: new Date() }
      },
      { new: true, runValidators: true }
    ).populate('accessRole', 'key name');

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Person access not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: updated._id?.toString?.() || updated.id,
        assignedToEmail: updated.assignedToEmail,
        assignedToName: updated.assignedToName,
        assignedToRole: updated.assignedToRole,
        accessRole: updated.accessRole?.name || '',
        accessRoleKey: updated.accessRole?.key || '',
        allowedAssignees: (updated.allowedAssignees || []).map((v) => v?.toString?.() || String(v)),
        allowedTaskTypes: Array.isArray(updated.allowedTaskTypes) ? updated.allowedTaskTypes : [],
        allowedBrands: Array.isArray(updated.allowedBrands) ? updated.allowedBrands : [],
        updatedAt: updated.updatedAt
      },
      message: 'Person access updated successfully'
    });
  } catch (err) {
    console.error('[MdImpexAccess] updatePersonAccess error:', err);
    return res.status(500).json({
      success: false,
      data: null,
      message: err?.message || 'Failed to update person access'
    });
  }
};

// Delete person-wise access
exports.deletePersonAccess = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Person access ID is required'
      });
    }

    const deleted = await PersonAccess.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Person access not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: `Person access for "${deleted.assignedToName}" deleted successfully`
    });
  } catch (err) {
    console.error('[MdImpexAccess] deletePersonAccess error:', err);
    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to delete person access'
    });
  }
};