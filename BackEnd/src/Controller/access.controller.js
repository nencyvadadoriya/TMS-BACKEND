const AccessModule = require('../model/AccessModule.model');
const UserPermission = require('../model/UserPermission.model');
const User = require('../model/user.model');
const Role = require('../model/Role.model');
const { ensureDefaultModules } = require('../middleware/permission.middleware');
const redisClient = require('../utils/redisClient');

const clearUserCache = async (userId) => {
    try {
        if (redisClient && redisClient.status === 'ready') {
            const keys = await redisClient.keys(`user:${userId}:perm:*`);
            if (keys.length > 0) await redisClient.del(keys);
        }
    } catch (e) {
        console.warn('[Redis] Cache clear error:', e.message);
    }
};

const clearGlobalCache = async () => {
    try {
        if (redisClient && redisClient.status === 'ready') {
            const keys = await redisClient.keys(`user:*:perm:*`);
            if (keys.length > 0) await redisClient.del(keys);
        }
    } catch (e) {
        console.warn('[Redis] Global cache clear error:', e.message);
    }
};


const permissionEnum = new Set(['allow', 'deny', 'own', 'team']);

const normalizeRoleKey = (value) => String(value || '').trim().toLowerCase();

const getDefaultForRole = (defaults, roleKey) => {
    if (!defaults) return undefined;
    if (defaults instanceof Map) return defaults.get(roleKey);
    return defaults[roleKey];
};

const canManageTargetUser = async (requester, targetUserId) => {
    const requesterRole = String(requester?.role || '').toLowerCase();
    const requesterId = String(requester?.id || requester?._id || '');
    if (!requesterId) return false;

    if (requesterRole === 'super_admin' || requesterRole === 'admin') return true;
    // Allow managers to manage their direct reports
    if (requesterRole === 'manager') {
        const target = await User.findById(targetUserId).select('managerId');
        if (!target) return false;
        const targetManagerId = String(target.managerId || '');
        if (String(target._id) === requesterId) return true;
        return targetManagerId && targetManagerId === requesterId;
    }

    // Allow MD Impex managers to manage users belonging to MD Impex company
    const mdManagerRoles = new Set(['md_manager', 'mdimpex_manager', 'md_impex_manager']);
    if (mdManagerRoles.has(requesterRole)) {
        const target = await User.findById(targetUserId).select('companyName');
        if (!target) return false;
        const normalize = (v) => String(v || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9_]/g, '');
        const targetCompany = normalize(target.companyName || target.company || '');
        if (!targetCompany) return false;
        // Accept variants like 'mdimpex', 'md_impex', 'mdimpexindia'
        return targetCompany.includes('mdimpex') || targetCompany.includes('md_impex') || targetCompany.includes('mdimpexindia');
    }

    return false;
};

exports.getRoles = async (req, res) => {
    try {
        await ensureDefaultModules();
        const roles = await Role.find({}).sort({ createdAt: 1 }).lean();
        return res.json({ success: true, data: roles });
    } catch {
        return res.status(500).json({ success: false, message: 'Failed to load roles' });
    }
};

exports.createRole = async (req, res) => {
    try {
        const requesterRole = normalizeRoleKey(req.user?.role);
        if (requesterRole !== 'admin' && requesterRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await ensureDefaultModules();

        const key = normalizeRoleKey(req.body?.key || req.body?.role || req.body?.roleKey);
        const name = String(req.body?.name || '').trim();

        if (!key || !name) {
            return res.status(400).json({ success: false, message: 'key and name are required' });
        }

        if (!/^[a-z0-9_-]+$/.test(key)) {
            return res.status(400).json({ success: false, message: 'Invalid key format' });
        }

        const existing = await Role.findOne({ key }).select('_id');
        if (existing) {
            return res.status(400).json({ success: false, message: 'Role already exists' });
        }

        const roleDoc = await Role.create({ key, name });

        // Copy assistant defaults for existing modules
        const modules = await AccessModule.find({}).select('moduleId defaults').lean();
        const bulk = modules.map((m) => {
            const assistantVal = getDefaultForRole(m.defaults, 'assistant');
            const safeVal = permissionEnum.has(String(assistantVal)) ? String(assistantVal) : 'deny';
            return {
                updateOne: {
                    filter: { moduleId: String(m.moduleId) },
                    update: { $set: { [`defaults.${key}`]: safeVal } },
                }
            };
        });

        if (bulk.length > 0) {
            await AccessModule.bulkWrite(bulk, { ordered: false });
        }

        await clearGlobalCache();

        return res.json({ success: true, data: roleDoc });
    } catch (e) {
        const message = e?.code === 11000 ? 'Role already exists' : 'Failed to create role';
        return res.status(400).json({ success: false, message });
    }
};

exports.updateRole = async (req, res) => {
    try {
        const requesterRole = normalizeRoleKey(req.user?.role);
        if (requesterRole !== 'admin' && requesterRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await ensureDefaultModules();

        const key = normalizeRoleKey(req.params?.key);
        const name = String(req.body?.name || '').trim();

        if (!key || !name) {
            return res.status(400).json({ success: false, message: 'name is required' });
        }

        if (!/^[a-z0-9_-]+$/.test(key)) {
            return res.status(400).json({ success: false, message: 'Invalid key format' });
        }

        const doc = await Role.findOneAndUpdate(
            { key },
            { $set: { name } },
            { new: true }
        );

        if (!doc) {
            return res.status(404).json({ success: false, message: 'Role not found' });
        }

        await clearGlobalCache();

        return res.json({ success: true, data: doc });
    } catch {
        return res.status(500).json({ success: false, message: 'Failed to update role' });
    }
};

exports.deleteRole = async (req, res) => {
    try {
        const requesterRole = normalizeRoleKey(req.user?.role);
        if (requesterRole !== 'admin' && requesterRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await ensureDefaultModules();

        const key = normalizeRoleKey(req.params?.key);
        if (!key) {
            return res.status(400).json({ success: false, message: 'Invalid role key' });
        }

        if (key === 'admin' || key === 'manager' || key === 'assistant') {
            return res.status(400).json({ success: false, message: 'Cannot delete core role' });
        }

        const doc = await Role.findOne({ key }).select('_id key');
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Role not found' });
        }

        await User.updateMany({ role: key }, { $set: { role: 'assistant' } });
        await AccessModule.updateMany({}, { $unset: { [`defaults.${key}`]: "" } });
        await Role.deleteOne({ _id: doc._id });

        await clearGlobalCache();

        return res.json({ success: true });
    } catch {
        return res.status(500).json({ success: false, message: 'Failed to delete role' });
    }
};

const getEffectivePermissionsMap = async (userId) => {
    await ensureDefaultModules();

    const user = await User.findById(userId).select('role');
    if (!user) return {};

    const role = String(user.role || '').toLowerCase();
    const modules = await AccessModule.find({}).lean();
    const overrides = await UserPermission.find({ userId }).lean();
    const overrideMap = new Map(overrides.map(o => [String(o.moduleId), String(o.value)]));

    const result = {};
    modules.forEach((m) => {
        const moduleId = String(m.moduleId);
        const overrideVal = overrideMap.get(moduleId);
        if (overrideVal && permissionEnum.has(overrideVal)) {
            result[moduleId] = overrideVal;
            return;
        }
        const roleKeyToCheck = role === 'marketer_manager' ? 'manager' : role;
        const def = getDefaultForRole(m.defaults, roleKeyToCheck) ? String(getDefaultForRole(m.defaults, roleKeyToCheck)) : 'deny';
        result[moduleId] = permissionEnum.has(def) ? def : 'deny';
    });

    return result;
};

exports.getModules = async (req, res) => {
    try {
        await ensureDefaultModules();
        const modules = await AccessModule.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
        return res.json({ success: true, data: modules });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Failed to load modules' });
    }
};

exports.createModule = async (req, res) => {
    try {
        const requesterRole = String(req.user?.role || '').toLowerCase();
        if (requesterRole !== 'admin' && requesterRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const { moduleId, name, defaults } = req.body || {};
        const safeModuleId = String(moduleId || '').trim();
        const safeName = String(name || '').trim();
        if (!safeModuleId || !safeName) {
            return res.status(400).json({ success: false, message: 'moduleId and name are required' });
        }

        const doc = await AccessModule.create({
            moduleId: safeModuleId,
            name: safeName,
            defaults: {
                admin: defaults?.admin || 'allow',
                manager: defaults?.manager || 'deny',
                assistant: defaults?.assistant || 'deny',
            }
        });

        await clearGlobalCache();

        return res.json({ success: true, data: doc });
    } catch (e) {
        const message = e?.code === 11000 ? 'Module already exists' : 'Failed to create module';
        return res.status(400).json({ success: false, message });
    }
};

exports.updateModule = async (req, res) => {
    try {
        const requesterRole = String(req.user?.role || '').toLowerCase();
        if (requesterRole !== 'admin' && requesterRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const moduleId = String(req.params.moduleId || '').trim();
        const { name, defaults } = req.body || {};

        const update = {};
        if (typeof name !== 'undefined') update.name = String(name || '').trim();
        if (typeof defaults !== 'undefined') {
            update.defaults = {
                admin: defaults?.admin || 'allow',
                manager: defaults?.manager || 'deny',
                assistant: defaults?.assistant || 'deny',
            };
        }

        const doc = await AccessModule.findOneAndUpdate({ moduleId }, update, { new: true });
        if (!doc) return res.status(404).json({ success: false, message: 'Module not found' });
        
        await clearGlobalCache();
        
        return res.json({ success: true, data: doc });
    } catch {
        return res.status(500).json({ success: false, message: 'Failed to update module' });
    }
};

exports.deleteModule = async (req, res) => {
    try {
        const requesterRole = String(req.user?.role || '').toLowerCase();
        if (requesterRole !== 'admin' && requesterRole !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const moduleId = String(req.params.moduleId || '').trim();
        const mod = await AccessModule.findOneAndUpdate(
            { moduleId },
            { $set: { isDeleted: true } },
            { new: true }
        );
        if (!mod) return res.status(404).json({ success: false, message: 'Module not found' });

        await UserPermission.deleteMany({ moduleId });
        
        await clearGlobalCache();
        
        return res.json({ success: true });
    } catch {
        return res.status(500).json({ success: false, message: 'Failed to delete module' });
    }
};

exports.getUserEffectivePermissions = async (req, res) => {
    try {
        const userId = String(req.params.userId || '').trim();
        const allowed = await canManageTargetUser(req.user, userId);
        if (!allowed) return res.status(403).json({ success: false, message: 'Access denied' });

        const effective = await getEffectivePermissionsMap(userId);
        return res.json({ success: true, data: effective });
    } catch {
        return res.status(500).json({ success: false, message: 'Failed to load permissions' });
    }
};

exports.setUserPermission = async (req, res) => {
    try {
        const userId = String(req.params.userId || '').trim();
        const moduleId = String(req.params.moduleId || '').trim();
        const value = String(req.body?.value || '').trim().toLowerCase();

        if (!permissionEnum.has(value)) {
            return res.status(400).json({ success: false, message: 'Invalid permission value' });
        }

        const allowed = await canManageTargetUser(req.user, userId);
        if (!allowed) return res.status(403).json({ success: false, message: 'Access denied' });

        await ensureDefaultModules();
        let moduleDoc = await AccessModule.findOne({ moduleId }).select('_id name defaults');
        
        // Auto-create module if it doesn't exist (for dynamically added frontend modules)
        if (!moduleDoc) {
            const moduleName = moduleId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const defaults = {
                super_admin: 'allow',
                admin: 'allow',
                md_manager: 'allow',
                ob_manager: 'allow',
                manager: 'allow',
                sbm: 'allow',
                troubleshoot_manager: 'allow',
                rm: 'allow',
                am: 'allow',
                ar: 'allow',
                assistant: 'allow',
                sub_assistance: 'allow'
            };
            
            // Set specific defaults based on module type
            if (moduleId === 'strike_page') {
                defaults.ob_manager = 'deny';
                defaults.sbm = 'deny';
                defaults.rm = 'deny';
                defaults.am = 'deny';
                defaults.ar = 'deny';
                defaults.assistant = 'deny';
                defaults.sub_assistance = 'deny';
                // defaults.troubleshoot_manager is 'allow' from base overrides
            }
            
            try {
                moduleDoc = await AccessModule.create({
                    moduleId,
                    name: moduleName,
                    defaults
                });
            } catch (createErr) {
                // If creation fails (e.g., race condition), try to find again
                moduleDoc = await AccessModule.findOne({ moduleId }).select('_id');
                if (!moduleDoc) {
                    return res.status(500).json({ success: false, message: 'Failed to create module' });
                }
            }
        }

        const doc = await UserPermission.findOneAndUpdate(
            { userId, moduleId },
            { value },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await clearUserCache(userId);

        return res.json({ success: true, data: doc });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Failed to update permission' });
    }
};

exports.applyTemplateToUser = async (req, res) => {
    try {
        const userId = String(req.params.userId || '').trim();
        const templateRole = normalizeRoleKey(req.body?.templateRole);
        const overwrite = Boolean(req.body?.overwrite);

        if (!templateRole) {
            return res.status(400).json({ success: false, message: 'Invalid templateRole' });
        }

        const roleExists = await Role.findOne({ key: templateRole }).select('_id');
        if (!roleExists) {
            return res.status(400).json({ success: false, message: 'Invalid templateRole' });
        }

        const allowed = await canManageTargetUser(req.user, userId);
        if (!allowed) return res.status(403).json({ success: false, message: 'Access denied' });

        await ensureDefaultModules();
        const modules = await AccessModule.find({ isDeleted: { $ne: true } }).lean();

        let existingSet = null;
        if (!overwrite) {
            const existing = await UserPermission.find({ userId }).select('moduleId').lean();
            existingSet = new Set((existing || []).map((e) => String(e.moduleId)));
        }

        const ops = modules
            .filter((m) => {
                if (overwrite) return true;
                const moduleId = String(m.moduleId);
                return !existingSet?.has(moduleId);
            })
            .map((m) => {
                const moduleId = String(m.moduleId);
                const val = getDefaultForRole(m.defaults, templateRole) ? String(getDefaultForRole(m.defaults, templateRole)) : 'deny';
                const safeVal = permissionEnum.has(val) ? val : 'deny';
                return {
                    updateOne: {
                        filter: { userId, moduleId },
                        update: { $set: { value: safeVal } },
                        upsert: true,
                    }
                };
            });

        if (ops.length > 0) {
            await UserPermission.bulkWrite(ops, { ordered: false });
        }

        await clearUserCache(userId);

        // Notify target user (if online) so their client can refresh permissions
        try {
            const { getIO } = require('../realtime/socket');
            const io = getIO();
            // emit a lightweight event to the user's personal room
            io.to(`user:${userId}`).emit('permissions:updated', { userId });
        } catch (e) {
            // ignore emit errors
        }

        return res.json({ success: true });
    } catch {
        return res.status(500).json({ success: false, message: 'Failed to apply template' });
    }
};

exports.getMyEffectivePermissions = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        const effective = await getEffectivePermissionsMap(userId);
        return res.json({ success: true, data: effective });
    } catch {
        return res.status(500).json({ success: false, message: 'Failed to load permissions' });
    }
};

exports._getEffectivePermissionsMap = getEffectivePermissionsMap;
