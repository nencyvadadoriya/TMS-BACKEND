const AccessModule = require('../model/AccessModule.model');
const UserPermission = require('../model/UserPermission.model');
const User = require('../model/user.model');
const Role = require('../model/Role.model');

const permissionEnum = new Set(['allow', 'deny']);

const ensureDefaultRoles = async () => {
    const defaults = [
        { moduleId: 'tasks_page', name: 'All Tasks', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', troubleshoot_manager: 'allow', sbm: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'allow', sales_man: 'allow' } },
        { moduleId: 'calendar_page', name: 'Calendar', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', troubleshoot_manager: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'allow', sales_man: 'allow' } },
        { moduleId: 'reviews_page', name: 'Reviews', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'deny', ob_manager: 'allow', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'other_work_page', name: 'Other Work', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'user_management', name: 'User Management', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'deny', sbm: 'allow', rm: 'allow', am: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brands_page', name: 'Brands', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', troubleshoot_manager: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'company_brand_task_type', name: 'Company Brand Task Type', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'company_task_type', name: 'Company Task Type', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'assign_page', name: 'Assign Page', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brand_create', name: 'Brand Create', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brand_edit', name: 'Brand Edit', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brand_delete', name: 'Brand Delete', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'deny', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brand_assign', name: 'Brand Assign', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'company_bulk_add', name: 'Company Bulk Add', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'company_edit', name: 'Company Edit', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'company_delete', name: 'Company Delete', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'deny', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brand_bulk_add', name: 'Brand Bulk Add', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'task_type_bulk_add', name: 'Task Type Bulk Add', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'create_task', name: 'Create Task', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', troubleshoot_manager: 'allow', sbm: 'allow', rm: 'allow', am: 'allow', ar: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'allow', sales_man: 'allow' } },
        { moduleId: 'assign_task', name: 'Assign Task', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', troubleshoot_manager: 'allow', sbm: 'allow', rm: 'allow', am: 'allow', ar: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'task_brand_assignment', name: 'Task Brand Assignment', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', troubleshoot_manager: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'edit_any_task', name: 'Edit Any Task', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'team', ob_manager: 'team', manager: 'own', rm: 'allow', am: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'delete_task', name: 'Delete Task', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'deny', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'view_all_tasks', name: 'View All Tasks', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', troubleshoot_manager: 'allow', sbm: 'allow', rm: 'allow', am: 'allow', ar: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'view_assigned_tasks', name: 'View Assigned Tasks', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', troubleshoot_manager: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'team_page', name: 'Team', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', sbm: 'allow', rm: 'allow', am: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'reports_analytics', name: 'Reports / Analytics', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'team', ob_manager: 'deny', manager: 'team', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'access_management', name: 'Access Management', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'deny', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'profile_page', name: 'Profile', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', troubleshoot_manager: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'allow', sales_man: 'allow' } },
        { moduleId: 'strike_page', name: 'Strike Page', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', troubleshoot_manager: 'allow', sbm: 'deny', rm: 'deny', am: 'deny', ar: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'personal_tasks_page', name: 'Personal Tasks Page', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', troubleshoot_manager: 'allow', sbm: 'allow', rm: 'allow', am: 'allow', ar: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'allow', sales_man: 'allow' } },
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
        { moduleId: 'tasks_page', name: 'All Tasks', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', sbm: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'allow', sales_man: 'allow' } },
        { moduleId: 'calendar_page', name: 'Calendar', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'allow', sales_man: 'allow' } },
        { moduleId: 'reviews_page', name: 'Reviews', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'deny', ob_manager: 'allow', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'other_work_page', name: 'Other Work', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'user_management', name: 'User Management', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'deny', sbm: 'allow', rm: 'allow', am: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brands_page', name: 'Brands', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'company_brand_task_type', name: 'Company Brand Task Type', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'company_task_type', name: 'Company Task Type', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'assign_page', name: 'Assign Page', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brand_create', name: 'Brand Create', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brand_edit', name: 'Brand Edit', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brand_delete', name: 'Brand Delete', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'deny', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brand_assign', name: 'Brand Assign', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'company_bulk_add', name: 'Company Bulk Add', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'company_edit', name: 'Company Edit', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'company_delete', name: 'Company Delete', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'deny', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'brand_bulk_add', name: 'Brand Bulk Add', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'task_type_bulk_add', name: 'Task Type Bulk Add', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'deny', manager: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'create_task', name: 'Create Task', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', sbm: 'allow', rm: 'allow', am: 'allow', ar: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'allow', sales_man: 'allow' } },
        { moduleId: 'assign_task', name: 'Assign Task', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', sbm: 'allow', rm: 'allow', am: 'allow', ar: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'task_brand_assignment', name: 'Task Brand Assignment', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'edit_any_task', name: 'Edit Any Task', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'team', ob_manager: 'team', manager: 'own', rm: 'allow', am: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'delete_task', name: 'Delete Task', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'deny', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'view_all_tasks', name: 'View All Tasks', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', sbm: 'allow', rm: 'allow', am: 'allow', ar: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'view_assigned_tasks', name: 'View Assigned Tasks', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'team_page', name: 'Team', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', sbm: 'allow', rm: 'allow', am: 'allow', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'reports_analytics', name: 'Reports / Analytics', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'team', ob_manager: 'deny', manager: 'team', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'access_management', name: 'Access Management', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'deny', ob_manager: 'deny', manager: 'deny', assistant: 'deny', sub_assistance: 'deny', sales_manager: 'deny', sales_man: 'deny' } },
        { moduleId: 'profile_page', name: 'Profile', defaults: { super_admin: 'allow', admin: 'allow', md_manager: 'allow', ob_manager: 'allow', manager: 'allow', assistant: 'allow', sub_assistance: 'allow', sales_manager: 'allow', sales_man: 'allow' } },
    ];

    try {
        const existing = await AccessModule.find({ moduleId: { $in: defaults.map(d => d.moduleId) } })
            .select('moduleId isDeleted defaults')
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
        if (missing.length > 0) {
            await AccessModule.insertMany(missing, { ordered: false });
        }

        const updateOps = [];
        for (const row of defaults) {
            const existingMod = (existing || []).find((m) => String(m?.moduleId) === String(row.moduleId));
            if (!existingMod || existingMod.isDeleted === true) continue;

            const existingDefaults = existingMod.defaults;
            const getDefaultValue = (key) => {
                if (!existingDefaults) return undefined;
                if (typeof existingDefaults.get === 'function') return existingDefaults.get(key);
                return existingDefaults[key];
            };
            const hasSuperAdmin = existingDefaults && (typeof existingDefaults.get === 'function'
                ? typeof existingDefaults.get('super_admin') !== 'undefined'
                : typeof existingDefaults?.super_admin !== 'undefined');
            const hasMdManager = existingDefaults && (typeof existingDefaults.get === 'function'
                ? typeof existingDefaults.get('md_manager') !== 'undefined'
                : typeof existingDefaults?.md_manager !== 'undefined');

            const hasObManager = existingDefaults && (typeof existingDefaults.get === 'function'
                ? typeof existingDefaults.get('ob_manager') !== 'undefined'
                : typeof existingDefaults?.ob_manager !== 'undefined');

            const hasSbm = existingDefaults && (typeof existingDefaults.get === 'function'
                ? typeof existingDefaults.get('sbm') !== 'undefined'
                : typeof existingDefaults?.sbm !== 'undefined');

            const hasRm = existingDefaults && (typeof existingDefaults.get === 'function'
                ? typeof existingDefaults.get('rm') !== 'undefined'
                : typeof existingDefaults?.rm !== 'undefined');

            const hasAm = existingDefaults && (typeof existingDefaults.get === 'function'
                ? typeof existingDefaults.get('am') !== 'undefined'
                : typeof existingDefaults?.am !== 'undefined');

            const hasAr = existingDefaults && (typeof existingDefaults.get === 'function'
                ? typeof existingDefaults.get('ar') !== 'undefined'
                : typeof existingDefaults?.ar !== 'undefined');

            const hasSalesManager = existingDefaults && (typeof existingDefaults.get === 'function'
                ? typeof existingDefaults.get('sales_manager') !== 'undefined'
                : typeof existingDefaults?.sales_manager !== 'undefined');

            const hasSalesMan = existingDefaults && (typeof existingDefaults.get === 'function'
                ? typeof existingDefaults.get('sales_man') !== 'undefined'
                : typeof existingDefaults?.sales_man !== 'undefined');

            const setPayload = {};
            if (!hasSuperAdmin && row.defaults?.super_admin) setPayload['defaults.super_admin'] = row.defaults.super_admin;
            if (!hasMdManager && row.defaults?.md_manager) setPayload['defaults.md_manager'] = row.defaults.md_manager;
            if (!hasObManager && row.defaults?.ob_manager) setPayload['defaults.ob_manager'] = row.defaults.ob_manager;
            if (!hasSbm && row.defaults?.sbm) setPayload['defaults.sbm'] = row.defaults.sbm;
            if (!hasRm && row.defaults?.rm) setPayload['defaults.rm'] = row.defaults.rm;
            if (!hasAm && row.defaults?.am) setPayload['defaults.am'] = row.defaults.am;
            if (!hasAr && row.defaults?.ar) setPayload['defaults.ar'] = row.defaults.ar;
            if (!hasSalesManager && row.defaults?.sales_manager) setPayload['defaults.sales_manager'] = row.defaults.sales_manager;
            if (!hasSalesMan && row.defaults?.sales_man) setPayload['defaults.sales_man'] = row.defaults.sales_man;
            if (!hasTroubleshootManager && row.defaults?.troubleshoot_manager) setPayload['defaults.troubleshoot_manager'] = row.defaults.troubleshoot_manager;

            if (String(row.moduleId) === 'edit_any_task') {
                const existingRm = String(getDefaultValue('rm') || '').toLowerCase();
                const existingAm = String(getDefaultValue('am') || '').toLowerCase();
                if (!existingRm || existingRm === 'deny') setPayload['defaults.rm'] = 'allow';
                if (!existingAm || existingAm === 'deny') setPayload['defaults.am'] = 'allow';
            }

            if (String(row.moduleId) === 'user_management') {
                const existingSbm = String(getDefaultValue('sbm') || '').toLowerCase();
                if (!existingSbm || existingSbm === 'deny') setPayload['defaults.sbm'] = 'allow';
            }
            if (Object.keys(setPayload).length === 0) continue;

            updateOps.push({
                updateOne: {
                    filter: { moduleId: String(row.moduleId) },
                    update: { $set: setPayload }
                }
            });
        }

        if (updateOps.length > 0) {
            await AccessModule.bulkWrite(updateOps, { ordered: false });
        }
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
            if (role === 'admin' || role === 'super_admin') return next();
            if ((role === 'sbm' || role === 'rm' || role === 'am' || role === 'ar' || role === 'troubleshoot_manager') && (moduleId === 'create_task' || moduleId === 'assign_task')) {
                return next();
            }

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

const requireAnyModulePermission = (moduleIds) => {
    const ids = Array.isArray(moduleIds) ? moduleIds : [moduleIds];

    return async (req, res, next) => {
        try {
            const role = String(req.user?.role || '').toLowerCase();
            if (role === 'admin' || role === 'super_admin') return next();
            if (role === 'sbm' || role === 'rm' || role === 'am' || role === 'ar' || role === 'troubleshoot_manager') {
                if (ids.includes('create_task') || ids.includes('assign_task')) {
                    return next();
                }
            }

            const userId = req.user?.id || req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }

            for (const moduleId of ids) {
                if (!moduleId) continue;
                const effective = await getEffectivePermissionForUser(userId, moduleId);
                if (String(effective).toLowerCase() !== 'deny') {
                    return next();
                }
            }

            return res.status(403).json({ success: false, message: 'Access denied' });
        } catch {
            return res.status(500).json({ success: false, message: 'Failed to check permissions' });
        }
    };
};

module.exports = {
    ensureDefaultRoles,
    ensureDefaultModules,
    getEffectivePermissionForUser,
    requireModulePermission,
    requireAnyModulePermission,
};
