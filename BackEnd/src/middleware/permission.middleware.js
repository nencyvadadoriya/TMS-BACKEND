const AccessModule = require('../model/AccessModule.model');
const UserPermission = require('../model/UserPermission.model');
const User = require('../model/user.model');
const Role = require('../model/Role.model');

const permissionEnum = new Set(['allow', 'deny', 'own', 'team']);

const ensureDefaultRoles = async () => {
    const defaults = [
        { key: 'admin', name: 'Administrator' },
        { key: 'manager', name: 'Manager' },
        { key: 'assistant', name: 'Assistant' },
    ];

    try {
        const existing = await Role.find({ key: { $in: defaults.map(d => d.key) } })
            .select('key')
            .lean();
        const existingKeys = new Set((existing || []).map(d => String(d.key)));
        const missing = defaults.filter(d => !existingKeys.has(String(d.key)));
        if (missing.length === 0) return;
        await Role.insertMany(missing, { ordered: false });
    } catch {
        // ignore duplicate errors
    }
};

const ensureDefaultModules = async () => {
    await ensureDefaultRoles();

    const defaults = [
        { moduleId: 'dashboard_view', name: 'Dashboard View', defaults: { admin: 'allow', manager: 'allow', assistant: 'allow' } },
        { moduleId: 'tasks_page', name: 'All Tasks', defaults: { admin: 'allow', manager: 'allow', assistant: 'allow' } },
        { moduleId: 'calendar_page', name: 'Calendar', defaults: { admin: 'allow', manager: 'allow', assistant: 'allow' } },
        { moduleId: 'user_management', name: 'User Management', defaults: { admin: 'allow', manager: 'deny', assistant: 'deny' } },
        { moduleId: 'brands_page', name: 'Brands', defaults: { admin: 'allow', manager: 'allow', assistant: 'allow' } },
        { moduleId: 'brand_create', name: 'Brand Create', defaults: { admin: 'allow', manager: 'allow', assistant: 'deny' } },
        { moduleId: 'brand_edit', name: 'Brand Edit', defaults: { admin: 'allow', manager: 'allow', assistant: 'deny' } },
        { moduleId: 'brand_delete', name: 'Brand Delete', defaults: { admin: 'allow', manager: 'deny', assistant: 'deny' } },
        { moduleId: 'brand_assign', name: 'Brand Assign', defaults: { admin: 'allow', manager: 'allow', assistant: 'deny' } },
        { moduleId: 'company_bulk_add', name: 'Company Bulk Add', defaults: { admin: 'allow', manager: 'allow', assistant: 'deny' } },
        { moduleId: 'brand_bulk_add', name: 'Brand Bulk Add', defaults: { admin: 'allow', manager: 'allow', assistant: 'deny' } },
        { moduleId: 'task_type_bulk_add', name: 'Task Type Bulk Add', defaults: { admin: 'allow', manager: 'allow', assistant: 'deny' } },
        { moduleId: 'create_task', name: 'Create Task', defaults: { admin: 'allow', manager: 'allow', assistant: 'deny' } },
        { moduleId: 'assign_task', name: 'Assign Task', defaults: { admin: 'allow', manager: 'allow', assistant: 'deny' } },
        { moduleId: 'edit_any_task', name: 'Edit Any Task', defaults: { admin: 'allow', manager: 'own', assistant: 'deny' } },
        { moduleId: 'delete_task', name: 'Delete Task', defaults: { admin: 'allow', manager: 'deny', assistant: 'deny' } },
        { moduleId: 'view_all_tasks', name: 'View All Tasks', defaults: { admin: 'allow', manager: 'allow', assistant: 'deny' } },
        { moduleId: 'view_assigned_tasks', name: 'View Assigned Tasks', defaults: { admin: 'allow', manager: 'allow', assistant: 'allow' } },
        { moduleId: 'team_page', name: 'Team', defaults: { admin: 'allow', manager: 'allow', assistant: 'deny' } },
        { moduleId: 'reports_analytics', name: 'Reports / Analytics', defaults: { admin: 'allow', manager: 'team', assistant: 'deny' } },
        { moduleId: 'access_management', name: 'Access Management', defaults: { admin: 'allow', manager: 'deny', assistant: 'deny' } },
        { moduleId: 'profile_page', name: 'Profile', defaults: { admin: 'allow', manager: 'allow', assistant: 'allow' } },
    ];

    try {
        const existing = await AccessModule.find({ moduleId: { $in: defaults.map(d => d.moduleId) } })
            .select('moduleId isDeleted')
            .lean();
        const existingActiveIds = new Set((existing || [])
            .filter(d => d && d.isDeleted !== true)
            .map(d => String(d.moduleId))
        );

        const existingDeletedIds = new Set((existing || [])
            .filter(d => d && d.isDeleted === true)
            .map(d => String(d.moduleId))
        );

        const missing = defaults.filter(d => !existingActiveIds.has(String(d.moduleId)) && !existingDeletedIds.has(String(d.moduleId)));
        if (missing.length === 0) return;

        await AccessModule.insertMany(missing, { ordered: false });
    } catch {
        // ignore duplicate errors
    }
};

const getEffectivePermissionForUser = async (userId, moduleId) => {
    await ensureDefaultModules();

    const user = await User.findById(userId).select('role');
    if (!user) return 'deny';

    const override = await UserPermission.findOne({ userId, moduleId }).select('value');
    if (override?.value && permissionEnum.has(override.value)) return override.value;

    const mod = await AccessModule.findOne({ moduleId }).select('defaults');
    if (!mod) return 'deny';

    const role = String(user.role || '').toLowerCase();
    const fallback = (mod.defaults && typeof mod.defaults.get === 'function')
        ? mod.defaults.get(role)
        : (mod.defaults && mod.defaults[role])
            ? mod.defaults[role]
            : 'deny';
    return permissionEnum.has(fallback) ? fallback : 'deny';
};

const requireModulePermission = (moduleId) => {
    return async (req, res, next) => {
        try {
            const role = String(req.user?.role || '').toLowerCase();
            if (role === 'admin') return next();

            const userId = req.user?.id || req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }

            const effective = await getEffectivePermissionForUser(userId, moduleId);
            if (String(effective).toLowerCase() === 'deny') {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }

            return next();
        } catch (e) {
            return res.status(500).json({ success: false, message: 'Failed to check permissions' });
        }
    };
};

module.exports = {
    ensureDefaultRoles,
    ensureDefaultModules,
    getEffectivePermissionForUser,
    requireModulePermission,
};
