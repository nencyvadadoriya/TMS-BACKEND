    // controllers/task.controller.js
const mongoose = require('mongoose');
const Task = require('../model/Task.model');
const Brand = require('../model/Brand.model');
const User = require('../model/user.model');
const Comment = require('../model/Comment.model');
const TaskHistory = require('../model/TaskHistory.model');
const { createTaskCalendarInvite, refreshAccessToken, updateGoogleTask, deleteGoogleTask } = require('../utils/googleCalendar.util');
const { sendTaskAssignedEmail } = require('../middleware/email.message');
const { sendTaskAssignedPush } = require('../utils/pushNotifications.util');
const { emitTaskUpserted } = require('../realtime/taskEvents');

const {
    recordStatusChange,
    recordApprovalChange,
    recordTaskUpdate,
    recordTaskReassigned,
    recordTaskDeleted
} = require('../utils/taskAudit.util');

const normalizeText = (value) => (value == null ? '' : String(value)).trim();

const normalizeEmail = (email) => normalizeText(email).toLowerCase();

const roleOf = (user) => {
    const raw = normalizeText(user?.role || '');
    return raw.toLowerCase().replace(/[\s-]+/g, '_');
};

const safeObjectIdString = (value) => {
    if (value == null) return '';
    try {
        if (typeof value === 'string') return value;
        if (typeof value === 'object' && typeof value.toString === 'function') return value.toString();
    } catch {
        return '';
    }
    return '';
};

const isAssistantRoleKey = (roleKey) => {
    const key = roleOf({ role: roleKey });
    return key === 'assistant'
        || key === 'sub_assistance'
        || key === 'sub_assistence'
        || key === 'sub_assist'
        || key === 'sub_assistant';
};

async function resolveBrandNameForTask(task) {
    try {
        const brandId = task?.brandId ? String(task.brandId) : '';
        if (brandId && mongoose.Types.ObjectId.isValid(brandId)) {
            const brandDoc = await Brand.findById(brandId).select('name').lean();
            const name = normalizeText(brandDoc?.name);
            if (name) return name;
        }
    } catch {
        // ignore
    }

    return normalizeText(task?.brand || '');
}

async function maybeAddBrandToAssignee({ assignedToEmail, brandId }) {
    try {
        const emailKey = normalizeEmail(assignedToEmail);
        const brandIdKey = brandId ? String(brandId) : '';

        if (!emailKey) return;
        if (!brandIdKey || !mongoose.Types.ObjectId.isValid(brandIdKey)) return;

        await User.updateOne(
            { email: emailKey },
            { $addToSet: { assignedBrandIds: brandIdKey }, $set: { updatedAt: new Date() } }
        );
    } catch {
        // ignore
    }
}

async function resolveTaskScopeEmails(user) {
    const scope = new Set();
    const requesterEmail = normalizeEmail(user?.email);

    if (requesterEmail) scope.add(requesterEmail);

    let requesterId = safeObjectIdString(user?.id || user?._id || user?.userId);
    if ((!requesterId || !mongoose.Types.ObjectId.isValid(requesterId)) && requesterEmail) {
        try {
            const doc = await User.findOne({ email: requesterEmail }).select('_id').lean();
            requesterId = safeObjectIdString(doc?._id);
        } catch {
            requesterId = '';
        }
    }

    if (!requesterId || !mongoose.Types.ObjectId.isValid(requesterId)) {
        return scope;
    }

    const queue = [requesterId];
    const visited = new Set(queue);

    while (queue.length > 0) {
        const parentId = queue.shift();

        const children = await User.find({ managerId: parentId })
            .select('_id email')
            .lean();

        for (const child of children || []) {
            const emailKey = normalizeEmail(child?.email);
            if (emailKey) scope.add(emailKey);

            const childId = safeObjectIdString(child?._id);
            if (childId && mongoose.Types.ObjectId.isValid(childId) && !visited.has(childId)) {
                visited.add(childId);
                queue.push(childId);
            }
        }
    }

    return scope;
}

async function resolveRmEmailForAmUser(user) {
    const requesterEmail = normalizeEmail(user?.email);
    const requesterId = safeObjectIdString(user?.id || user?._id || user?.userId);

    let managerId = safeObjectIdString(user?.managerId);
    if (!managerId) {
        try {
            const amDoc = requesterId && mongoose.Types.ObjectId.isValid(requesterId)
                ? await User.findById(requesterId).select('managerId').lean()
                : requesterEmail
                    ? await User.findOne({ email: requesterEmail }).select('managerId').lean()
                    : null;
            managerId = safeObjectIdString(amDoc?.managerId);
        } catch {
            managerId = '';
        }
    }

    const visited = new Set();
    let currentId = managerId;
    let depth = 0;
    while (currentId && mongoose.Types.ObjectId.isValid(currentId) && depth < 6) {
        if (visited.has(currentId)) break;
        visited.add(currentId);

        const manager = await User.findById(currentId).select('email role managerId').lean();
        const managerRole = roleOf(manager);
        const managerEmail = normalizeEmail(manager?.email);

        if (managerRole === 'rm' && managerEmail) return managerEmail;

        currentId = safeObjectIdString(manager?.managerId);
        depth += 1;
    }

    return '';
}

async function userCanAccessTask(task, user) {
    const requesterRole = roleOf(user);
    const requesterEmail = normalizeEmail(user?.email);

    if (requesterRole === 'admin' || requesterRole === 'super_admin') return true;

    const assignedToEmail = normalizeEmail(task?.assignedTo);
    const assignedByEmail = normalizeEmail(task?.assignedBy);
    const obManagerEmail = normalizeEmail(task?.obManagerEmail);

    if (requesterEmail && (
        assignedToEmail === requesterEmail || 
        assignedByEmail === requesterEmail || 
        obManagerEmail === requesterEmail
    )) return true;

    if (requesterRole === 'sbm' || requesterRole === 'rm' || requesterRole === 'ar' || requesterRole === 'manager' || requesterRole === 'md_manager' || requesterRole === 'am') {
        const scope = await resolveTaskScopeEmails(user);
        if (scope.has(assignedToEmail) || scope.has(assignedByEmail)) return true;
    }

    if (requesterRole === 'ob_manager') {
        const requesterId = safeObjectIdString(user?.id || user?._id || user?.userId);
        let requesterCompany = normalizeText(user?.companyName || user?.company);
        if (!requesterCompany && requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
            const doc = await User.findById(requesterId).select('companyName').lean();
            requesterCompany = normalizeText(doc?.companyName);
        }

        const escapeRegex = (v) => String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const companySafe = requesterCompany ? escapeRegex(requesterCompany) : '';

        if (companySafe) {
            const assistantDocs = await User.find({
                companyName: { $regex: `^${companySafe}$`, $options: 'i' },
                role: { $in: ['assistant', 'sub_assistance', 'sub_assistence', 'sub_assist', 'sub_assistant'] }
            }).select('email').lean();

            const assistantEmails = new Set(
                (assistantDocs || []).map((u) => normalizeEmail(u?.email)).filter(Boolean)
            );

            if (assistantEmails.has(assignedToEmail)) return true;
        }
    }

    return false;
}

function getActorFromRequest(req) {
    const id = safeObjectIdString(req.user?.id || req.user?._id || req.user?.userId);
    return {
        id,
        name: normalizeText(req.user?.name || 'User'),
        email: normalizeEmail(req.user?.email),
        role: roleOf(req.user)
    };
}

function userIsTaskAssigner(task, user) {
    return normalizeEmail(task?.assignedBy) && normalizeEmail(task?.assignedBy) === normalizeEmail(user?.email);
}

function canViewTaskReviews(user) {
    const r = roleOf(user);
    return r === 'admin'
        || r === 'super_admin'
        || r === 'ob_manager'
        || r === 'rm'
        || r === 'am'
        || r === 'sbm'
        || r === 'ar'
        || r === 'manager'
        || r === 'md_manager'
        || isAssistantRoleKey(r);
}

function canSubmitTaskReview(user) {
    const r = roleOf(user);
    return r === 'admin' || r === 'super_admin' || r === 'manager' || r === 'md_manager' || r === 'ob_manager';
}

exports.addTask = async (req, res) => {
    try {
        const title = normalizeText(req.body?.title);
        const assignedTo = normalizeEmail(req.body?.assignedTo);
        const dueDateRaw = req.body?.dueDate;
        const dueDate = dueDateRaw ? new Date(dueDateRaw) : null;

        if (!title) {
            return res.status(400).json({ success: false, message: 'Task title is required' });
        }

        if (!assignedTo) {
            return res.status(400).json({ success: false, message: 'Assignee email is required' });
        }

        if (!dueDate || Number.isNaN(dueDate.getTime())) {
            return res.status(400).json({ success: false, message: 'Due date is required' });
        }

        const requesterRole = roleOf(req.user);
        const assignedBy = normalizeEmail(req.user?.email);
        if (!assignedBy) {
            return res.status(400).json({ success: false, message: 'Invalid assigner' });
        }

        const priority = normalizeText(req.body?.priority) || 'medium';
        const taskType = normalizeText(req.body?.taskType || req.body?.type) || 'regular';

        const rawCompanyName = normalizeText(req.body?.companyName || req.body?.company);
        const requesterCompany = normalizeText(req.user?.companyName || req.user?.company);
        const companyName = (requesterRole === 'admin' || requesterRole === 'super_admin')
            ? (rawCompanyName || requesterCompany)
            : (requesterCompany || rawCompanyName);

        let brandId = req.body?.brandId ? String(req.body.brandId) : '';
        if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) {
            brandId = '';
        }

        let brandName = normalizeText(req.body?.brand);
        if (brandId && !brandName) {
            const brandDoc = await Brand.findById(brandId).select('name').lean();
            brandName = normalizeText(brandDoc?.name);
        }

        const obManagerEmail = requesterRole === 'ob_manager' ? assignedBy : null;

        const task = new Task({
            title,
            assignedTo,
            assignedBy,
            dueDate,
            priority,
            taskType,
            companyName,
            brand: brandName,
            brandId: brandId || null,
            obManagerEmail,
            status: 'pending',
            statusUpdatedAt: Date.now(),
            completedApproval: false
        });

        const savedTask = await task.save();

        await maybeAddBrandToAssignee({
            assignedToEmail: savedTask?.assignedTo,
            brandId: savedTask?.brandId
        });

        const [assignedToUser, assignedByUser] = await Promise.all([
            User.findOne({ email: savedTask.assignedTo }).select('_id name email avatar role').lean(),
            User.findOne({ email: savedTask.assignedBy }).select('_id name email avatar role').lean()
        ]);

        const resolvedBrandName = await resolveBrandNameForTask(savedTask);
        const responseData = {
            ...savedTask.toObject(),
            id: savedTask._id,
            brand: resolvedBrandName || (savedTask.brand || ''),
            assignedToUser: assignedToUser ? {
                id: assignedToUser._id,
                name: assignedToUser.name,
                email: assignedToUser.email,
                avatar: assignedToUser.avatar,
                role: assignedToUser.role,
            } : { email: savedTask.assignedTo },
            assignedByUser: assignedByUser ? {
                id: assignedByUser._id,
                name: assignedByUser.name,
                email: assignedByUser.email,
                avatar: assignedByUser.avatar,
                role: assignedByUser.role,
            } : { email: savedTask.assignedBy }
        };

        try {
            emitTaskUpserted(responseData);
        } catch (emitError) {
            console.error('emitTaskUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
        }

        Promise.resolve()
            .then(async () => {
                const toName = assignedToUser?.name || 'User';
                const assignedByName = assignedByUser?.name || req.user?.name || 'User';

                await sendTaskAssignedEmail({
                    toEmail: savedTask.assignedTo,
                    toName,
                    assignedByName,
                    assignedByEmail: assignedBy,
                    task: {
                        title: savedTask.title,
                        priority: savedTask.priority,
                        status: savedTask.status,
                        companyName: savedTask.companyName,
                        brand: resolvedBrandName || savedTask.brand,
                        dueDate: savedTask.dueDate
                    }
                });

                try {
                    await sendTaskAssignedPush({
                        toEmail: savedTask.assignedTo,
                        task: savedTask,
                        assignedByName
                    });
                } catch (pushErr) {
                    console.error('Task assignment push failed:', pushErr?.message || pushErr);
                }
            })
            .catch((err) => {
                console.error('Task assignment email failed:', err?.message || err);
            });

        return res.status(201).json({
            success: true,
            message: 'Task created successfully',
            data: responseData
        });
    } catch (error) {
        console.error('Error creating task:', error);
        return res.status(500).json({
            success: false,
            message: 'Error creating task',
            error: error.message
        });
    }
};

exports.getAllTasks = async (req, res) => {
    try {
        const requesterRole = roleOf(req.user);
        const requesterEmail = normalizeEmail(req.user?.email);

        console.log('getAllTasks called by:', { requesterRole, requesterEmail });

        let tasks;
        if (requesterRole === 'admin' || requesterRole === 'super_admin') {
            tasks = await Task.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
            console.log('Admin fetching all tasks, count:', tasks.length);
        } else if (requesterRole === 'am') {
            const rmEmail = await resolveRmEmailForAmUser(req.user);
            const sharedEmails = Array.from(new Set([requesterEmail, rmEmail].filter(Boolean)));
            tasks = await Task.find({
                isDeleted: { $ne: true },
                $or: [
                    { assignedTo: { $in: sharedEmails } },
                    { assignedBy: { $in: sharedEmails } }
                ]
            }).sort({ createdAt: -1 }).lean();
            console.log('AM tasks, count:', tasks.length);
        } else if (requesterRole === 'sbm' || requesterRole === 'rm' || requesterRole === 'ar') {
            const scope = await resolveTaskScopeEmails(req.user);
            const scopeEmails = Array.from(scope);
            console.log('Scope emails for role', requesterRole, ':', scopeEmails);
            if (scopeEmails.length === 0) {
                tasks = [];
            } else {
                tasks = await Task.find({
                    isDeleted: { $ne: true },
                    $or: [
                        { assignedTo: { $in: scopeEmails } },
                        { assignedBy: { $in: scopeEmails } }
                    ]
                }).sort({ createdAt: -1 }).lean();
            }
            console.log('Tasks for scope, count:', tasks.length);
        } else if (requesterRole === 'ob_manager') {
            const requesterId = safeObjectIdString(req.user?.id || req.user?._id || req.user?.userId);
            let requesterCompany = (req.user?.companyName || '').toString().trim();
            if (!requesterCompany && requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
                const doc = await User.findById(requesterId).select('companyName').lean();
                requesterCompany = (doc?.companyName || '').toString().trim();
            }

            const escapeRegex = (v) => String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const companySafe = requesterCompany ? escapeRegex(requesterCompany) : '';

            const teamRoles = ['assistant', 'sub_assistance', 'sub_assistence', 'sub_assist', 'sub_assistant', 'manager'];
            const assistantDocs = companySafe
                ? await User.find({
                    companyName: { $regex: `^${companySafe}$`, $options: 'i' },
                    role: { $in: teamRoles }
                }).select('email').lean()
                : [];

            const assistantEmails = (assistantDocs || [])
                .map((u) => normalizeEmail(u?.email))
                .filter(Boolean);

            const or = [];
            if (assistantEmails.length > 0) or.push({ assignedTo: { $in: assistantEmails } });
            if (requesterEmail) {
                or.push({ obManagerEmail: requesterEmail });
                or.push({ assignedTo: requesterEmail });
                or.push({ assignedBy: requesterEmail });
            }

            if (or.length === 0) {
                tasks = [];
            } else {
                tasks = await Task.find({
                    isDeleted: { $ne: true },
                    $or: or
                }).sort({ createdAt: -1 }).lean();
            }
            console.log('OB Manager tasks, count:', tasks.length);
        } else if (requesterRole === 'manager' || requesterRole === 'md_manager') {
            const scope = await resolveTaskScopeEmails(req.user);

            const requesterId = safeObjectIdString(req.user?.id || req.user?._id || req.user?.userId);
            let requesterCompany = (req.user?.companyName || '').toString().trim();
            if (!requesterCompany && requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
                const doc = await User.findById(requesterId).select('companyName').lean();
                requesterCompany = (doc?.companyName || '').toString().trim();
            }

            const escapeRegex = (v) => String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const companySafe = requesterCompany ? escapeRegex(requesterCompany) : '';

            const teamRoles = ['manager', 'assistant', 'sub_assistance', 'sub_assistence', 'sub_assist', 'sub_assistant'];
            const teamDocs = companySafe
                ? await User.find({
                    companyName: { $regex: `^${companySafe}$`, $options: 'i' },
                    role: { $in: teamRoles }
                }).select('email').lean()
                : [];

            const teamEmails = (teamDocs || [])
                .map((u) => normalizeEmail(u?.email))
                .filter(Boolean);

            const scopeEmails = Array.from(new Set([...Array.from(scope), ...teamEmails].filter(Boolean)));
            console.log('Scope emails for role', requesterRole, ':', scopeEmails);

            if (scopeEmails.length === 0) {
                tasks = [];
            } else {
                tasks = await Task.find({
                    isDeleted: { $ne: true },
                    $or: [
                        { assignedTo: { $in: scopeEmails } },
                        { assignedBy: { $in: scopeEmails } }
                    ]
                }).sort({ createdAt: -1 }).lean();
            }

            console.log(`${requesterRole} tasks, count:`, tasks.length);
        } else {
            tasks = await Task.find({
                isDeleted: { $ne: true },
                $or: [
                    { assignedTo: requesterEmail },
                    { assignedBy: requesterEmail }
                ]
            }).sort({ createdAt: -1 }).lean();
            console.log('Default tasks for', requesterEmail, ', count:', tasks.length);
        }

        const emails = Array.from(
            new Set(
                tasks
                    .flatMap((t) => [t?.assignedTo, t?.assignedBy])
                    .filter((e) => typeof e === 'string' && e.trim())
                    .map((e) => normalizeEmail(e))
                    .filter(Boolean)
            )
        );

        const brandIds = Array.from(
            new Set(
                tasks
                    .map((t) => (t?.brandId ? t.brandId.toString() : ''))
                    .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
            )
        );

        const [users, brands] = await Promise.all([
            emails.length
                ? User.find({ email: { $in: emails } })
                    .select('_id name email avatar role')
                    .lean()
                : Promise.resolve([]),
            brandIds.length
                ? Brand.find({ _id: { $in: brandIds } })
                    .select('_id name')
                    .lean()
                : Promise.resolve([])
        ]);

        const userByEmail = new Map(users.map((u) => [normalizeEmail(u.email), u]));
        const brandById = new Map(brands.map((b) => [b._id.toString(), b]));

        const tasksWithUserDetails = tasks.map((task) => {
            const assignedToUser = typeof task.assignedTo === 'string'
                ? userByEmail.get(normalizeEmail(task.assignedTo))
                : null;
            const assignedByUser = typeof task.assignedBy === 'string'
                ? userByEmail.get(normalizeEmail(task.assignedBy))
                : null;

            const brandIdKey = task?.brandId ? task.brandId.toString() : '';
            const brandDoc = brandIdKey ? brandById.get(brandIdKey) : null;
            const resolvedBrandName = (brandDoc?.name || task?.brand || '').toString();

            return {
                ...task,
                id: task._id,
                brand: resolvedBrandName,
                assignedToUser: assignedToUser ? {
                    id: assignedToUser._id,
                    name: assignedToUser.name,
                    email: assignedToUser.email,
                    avatar: assignedToUser.avatar,
                    role: assignedToUser.role,
                } : { email: task.assignedTo },
                assignedByUser: assignedByUser ? {
                    id: assignedByUser._id,
                    name: assignedByUser.name,
                    email: assignedByUser.email,
                    avatar: assignedByUser.avatar,
                    role: assignedByUser.role,
                } : { email: task.assignedBy }
            };
        });

        return res.json({
            success: true,
            data: tasksWithUserDetails,
            message: 'Tasks fetched successfully'
        });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        return res.status(500).json({ success: false, message: 'Error fetching tasks', error: error.message });
    }
};

exports.getSingleTask = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid task id' });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (task.isDeleted) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (!await userCanAccessTask(task, req.user)) {
            return res.status(403).json({ success: false, message: 'You are not authorized to view this task' });
        }

        let assignedToUser = null;
        let assignedByUser = null;

        if (typeof task.assignedTo === 'string') {
            assignedToUser = await User.findOne({ email: task.assignedTo });
        }

        if (typeof task.assignedBy === 'string') {
            assignedByUser = await User.findOne({ email: task.assignedBy });
        }

        const resolvedBrandName = await resolveBrandNameForTask(task);

        return res.json({
            success: true,
            message: 'Task retrieved successfully',
            data: {
                ...task.toObject(),
                id: task._id,
                brand: resolvedBrandName || (task.brand || ''),
                assignedToUser: assignedToUser ? {
                    id: assignedToUser._id,
                    name: assignedToUser.name,
                    email: assignedToUser.email,
                    avatar: assignedToUser.avatar,
                    role: assignedToUser.role,
                } : { email: task.assignedTo },
                assignedByUser: assignedByUser ? {
                    id: assignedByUser._id,
                    name: assignedByUser.name,
                    email: assignedByUser.email,
                    avatar: assignedByUser.avatar,
                    role: assignedByUser.role,
                } : { email: task.assignedBy }
            }
        });
    } catch (error) {
        console.error('Error fetching task:', error);
        return res.status(500).json({ success: false, message: 'Error fetching task', error: error.message });
    }
};

exports.addTaskComment = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { content } = req.body;

        if (!mongoose.Types.ObjectId.isValid(taskId)) {
            return res.status(400).json({ success: false, message: 'Invalid task id' });
        }

        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, message: 'Comment content is required' });
        }

        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (task.isDeleted) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (!await userCanAccessTask(task, req.user)) {
            return res.status(403).json({ success: false, message: 'You are not authorized to comment on this task' });
        }

        const actor = getActorFromRequest(req);
        const comment = await Comment.create({
            taskId: task._id,
            content: content.trim(),
            userId: actor.id,
            userName: actor.name,
            userEmail: actor.email,
            userRole: actor.role
        });

        await Task.findByIdAndUpdate(taskId, {
            $addToSet: { comments: comment._id },
            updatedAt: Date.now()
        });

        await TaskHistory.create({
            taskId,
            action: 'comment_added',
            message: `Comment added by ${actor.name}`,
            oldStatus: task.status || null,
            newStatus: task.status || null,
            note: content.trim(),
            additionalData: {
                commentId: comment._id.toString(),
                content: content.trim()
            },
            userId: actor.id,
            user: {
                userId: actor.id,
                userName: actor.name,
                userEmail: actor.email,
                userRole: actor.role
            }
        });

        return res.status(201).json({
            success: true,
            message: 'Comment added successfully',
            data: {
                ...comment.toObject(),
                id: comment._id
            }
        });
    } catch (error) {
        console.error('Error adding comment:', error);
        return res.status(500).json({ success: false, message: 'Error adding comment', error: error.message });
    }
};

exports.getTaskComments = async (req, res) => {
    try {
        const { taskId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(taskId)) {
            return res.status(400).json({ success: false, message: 'Invalid task id' });
        }

        const task = await Task.findById(taskId).lean();
        if (!task) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (task.isDeleted) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (!await userCanAccessTask(task, req.user)) {
            return res.status(403).json({ success: false, message: 'You are not authorized to view comments for this task' });
        }

        const comments = await Comment.find({ taskId }).sort({ createdAt: -1 }).lean();
        return res.json({
            success: true,
            data: comments.map((c) => ({ ...c, id: c._id })),
            message: 'Comments fetched successfully'
        });
    } catch (error) {
        console.error('Error fetching comments:', error);
        return res.status(500).json({ success: false, message: 'Error fetching comments', error: error.message });
    }
};

exports.deleteTaskComment = async (req, res) => {
    try {
        const { taskId, commentId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(taskId) || !mongoose.Types.ObjectId.isValid(commentId)) {
            return res.status(400).json({ success: false, message: 'Invalid task id or comment id' });
        }

        const comment = await Comment.findById(commentId);
        if (!comment || comment.taskId.toString() !== taskId) {
            return res.status(404).json({ success: false, message: 'Comment not found' });
        }

        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (task.isDeleted) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (!await userCanAccessTask(task, req.user)) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this comment' });
        }

        await Comment.deleteOne({ _id: commentId });
        await Task.findByIdAndUpdate(taskId, {
            $pull: { comments: commentId },
            updatedAt: Date.now()
        });

        try {
            const actor = getActorFromRequest(req);
            const historyEntry = await TaskHistory.create({
                taskId,
                action: 'comment_deleted',
                message: `Comment deleted by ${actor.name}`,
                oldStatus: task.status || null,
                newStatus: task.status || null,
                note: '',
                additionalData: {
                    commentId: commentId.toString(),
                    deletedAt: new Date().toISOString()
                },
                userId: actor.id,
                user: {
                    userId: actor.id,
                    userName: actor.name,
                    userEmail: actor.email,
                    userRole: actor.role
                }
            });

            await Task.findByIdAndUpdate(taskId, {
                $addToSet: { history: historyEntry._id },
                updatedAt: Date.now()
            });
        } catch (historyError) {
            console.error('Error recording comment delete history:', historyError);
        }

        return res.json({ success: true, message: 'Comment deleted successfully' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        return res.status(500).json({ success: false, message: 'Error deleting comment', error: error.message });
    }
};

exports.addTaskHistory = async (req, res) => {
    try {
        const { taskId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(taskId)) {
            return res.status(400).json({ success: false, message: 'Invalid task id' });
        }

        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (task.isDeleted) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (!await userCanAccessTask(task, req.user)) {
            return res.status(403).json({ success: false, message: 'You are not authorized to add history for this task' });
        }

        const actor = getActorFromRequest(req);
        const { action, message, oldStatus, newStatus, note, additionalData } = req.body || {};
        if (!action || !message) {
            return res.status(400).json({ success: false, message: 'Action and message are required' });
        }

        const historyEntry = await TaskHistory.create({
            taskId,
            action,
            message,
            oldStatus: oldStatus || null,
            newStatus: newStatus || null,
            note: note || '',
            additionalData: additionalData || {},
            userId: actor.id,
            user: {
                userId: actor.id,
                userName: actor.name,
                userEmail: actor.email,
                userRole: actor.role
            }
        });

        await Task.findByIdAndUpdate(taskId, {
            $addToSet: { history: historyEntry._id },
            updatedAt: Date.now()
        });

        return res.status(201).json({
            success: true,
            message: 'History added successfully',
            data: historyEntry
        });
    } catch (error) {
        console.error('Error adding history:', error);
        return res.status(500).json({ success: false, message: 'Error adding history', error: error.message });
    }
};

exports.getTaskHistory = async (req, res) => {
    try {
        const { taskId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(taskId)) {
            return res.status(400).json({ success: false, message: 'Invalid task id' });
        }

        const task = await Task.findById(taskId).lean();
        if (!task) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (!await userCanAccessTask(task, req.user)) {
            return res.status(403).json({ success: false, message: 'You are not authorized to view history for this task' });
        }

        const historyEntries = await TaskHistory.find({ taskId }).sort({ timestamp: -1 }).lean();
        const formatted = historyEntries.map((entry) => ({
            ...entry,
            id: entry._id,
            userName: entry.user?.userName || entry.userName || 'System',
            userEmail: entry.user?.userEmail || entry.userEmail || 'system@task-app.local',
            userRole: entry.user?.userRole || entry.userRole || 'system',
            timestamp: entry.timestamp || entry.createdAt || entry.updatedAt
        }));

        return res.json({
            success: true,
            data: formatted,
            message: 'Task history fetched successfully'
        });
    } catch (error) {
        console.error('Error fetching task history:', error);
        return res.status(500).json({ success: false, message: 'Error fetching task history', error: error.message });
    }
};

exports.inviteToTask = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { email, role, message } = req.body;

        if (!mongoose.Types.ObjectId.isValid(taskId)) {
            return res.status(400).json({ success: false, message: 'Invalid task id' });
        }

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (task.isDeleted) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (!await userCanAccessTask(task, req.user)) {
            return res.status(403).json({ success: false, message: 'You are not authorized to invite users to this task' });
        }

        const invitedBy = req.user?.email;
        task.invitations.push({
            email,
            role: role || 'viewer',
            status: 'pending',
            invitedBy,
            invitedAt: new Date()
        });

        const actor = getActorFromRequest(req);
        const historyEntry = await TaskHistory.create({
            taskId,
            action: 'collaborator_invited',
            message: `Invited ${email} as ${role || 'viewer'}`,
            userId: actor.id,
            user: {
                userId: actor.id,
                userName: actor.name,
                userEmail: actor.email,
                userRole: actor.role
            },
            note: message || ''
        });

        task.history.push(historyEntry._id);
        await task.save();

        return res.json({ success: true, message: 'User invited successfully', data: task });
    } catch (error) {
        console.error('Error inviting to task:', error);

        return res.status(500).json({
            success: false,
            message: 'Failed to invite user',
            error: error.message
        });
    }
};

// 4. UPDATE TASK
exports.updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body };

        const note = updates.note || '';
        const requestRecheck = Boolean(updates.requestRecheck);

        delete updates.note;
        delete updates.requestRecheck;

        console.log(" Updating task:", id, updates);

        // Remove fields that shouldn't be updated
        delete updates._id;
        delete updates.createdAt;

        // Convert dueDate to Date if provided
        if (updates.dueDate) {
            updates.dueDate = new Date(updates.dueDate);
        }

        if (updates.companyName == null && updates.company != null) {
            updates.companyName = updates.company;
        }

        if (updates.taskType == null && updates.type != null) {
            updates.taskType = updates.type;
        }

        if (updates.brandId && !updates.brand) {
            const brandId = updates.brandId.toString();
            if (mongoose.Types.ObjectId.isValid(brandId)) {
                const brandDoc = await Brand.findById(brandId).select('name').lean();
                if (brandDoc?.name) {
                    updates.brand = brandDoc.name;
                }
            }
        }

        const previousTask = await Task.findById(id);

        if (!previousTask) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        if (previousTask.isDeleted) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        const requesterRole = roleOf(req.user);
        const isAdmin = requesterRole === 'admin' || requesterRole === 'super_admin';
        const requesterEmail = normalizeEmail(req.user?.email);
        const isAssigner = userIsTaskAssigner(previousTask, req.user);
        const isAssignee = requesterEmail && normalizeEmail(previousTask.assignedTo) === requesterEmail;

        const normalizeCompanyKey = (value) => normalizeText(value).toLowerCase().replace(/\s+/g, '');
        const SPEED_E_COM_COMPANY_KEY = 'speedecom';
        const taskCompanyKey = normalizeCompanyKey(previousTask.companyName || previousTask.company);
        const isSpeedEcomTask = taskCompanyKey === SPEED_E_COM_COMPANY_KEY;

        const hasDueDateKey = Object.prototype.hasOwnProperty.call(updates || {}, 'dueDate');
        const canEditDueDateForSpeedEcom = Boolean(
            isAssignee || (isAssigner && Object.prototype.hasOwnProperty.call(updates || {}, 'assignedTo'))
        );
        if (hasDueDateKey && isSpeedEcomTask && !canEditDueDateForSpeedEcom) {
            return res.status(403).json({
                success: false,
                message: 'Only the assignee can update due date for Speed E Com tasks'
            });
        }

        const KEYURI_EMAIL = normalizeEmail('keyurismartbiz@gmail.com');
        const RUTU_EMAIL = normalizeEmail('rutusmartbiz@gmail.com');

        const hasAssignedToKey = Object.prototype.hasOwnProperty.call(updates || {}, 'assignedTo');
        const nextAssignedTo = hasAssignedToKey ? normalizeEmail(updates.assignedTo) : '';
        const prevAssignedTo = normalizeEmail(previousTask.assignedTo);
        const isReassignment = Boolean(hasAssignedToKey && nextAssignedTo && nextAssignedTo !== prevAssignedTo);

        const hasStatusKey = Object.prototype.hasOwnProperty.call(updates || {}, 'status');
        const hasApprovalKey = Object.prototype.hasOwnProperty.call(updates || {}, 'completedApproval');

        // If assignee changes (reassignment) and client didn't explicitly request a status change,
        // mark task as reassigned so it is visible in UI and history.
        if (isReassignment && !hasStatusKey) {
            updates.status = 'reassigned';
        }

        // If assignee moves task back to pending, force-clear approval on the server.
        // (This should not block assignee.)
        const desiredStatus = hasStatusKey ? String(updates.status || '').toLowerCase() : '';
        const isPendingTransition = hasStatusKey && desiredStatus === 'pending';
        if (isPendingTransition) {
            updates.completedApproval = false;
        }

        const statusOnlyAllowedKeys = new Set(['status', 'completedApproval', 'statusUpdatedAt']);
        const updateKeys = Object.keys(updates || {});
        const otherUpdateKeys = updateKeys.filter((k) => !statusOnlyAllowedKeys.has(k));

        if (Boolean(previousTask.completedApproval) && otherUpdateKeys.length > 0) {
            return res.status(403).json({
                success: false,
                message: 'This task has been permanently approved and cannot be edited'
            });
        }

        if (otherUpdateKeys.length > 0) {
            const isObManager = requesterRole === 'ob_manager';

            const canEditTaskDetails = Boolean(
                isAdmin
                || isAssigner
                || (requesterEmail === KEYURI_EMAIL)
                || ((requesterRole === 'rm' || requesterRole === 'am') && (await userCanAccessTask(previousTask, req.user)))
            );

            const allowedObManagerUpdateKeys = new Set(['assignedTo', 'assignedToUser']);
            const obManagerOnlyTouchesAssignedTo = isObManager && otherUpdateKeys.every((k) => allowedObManagerUpdateKeys.has(k));

            const allowedKeyuriUpdateKeys = new Set(['assignedTo', 'assignedToUser']);
            const keyuriOnlyTouchesAssignedTo = Boolean(
                requesterEmail && requesterEmail === KEYURI_EMAIL &&
                otherUpdateKeys.every((k) => allowedKeyuriUpdateKeys.has(k))
            );

            if (obManagerOnlyTouchesAssignedTo) {
                const assignee = updates.assignedTo ? normalizeEmail(updates.assignedTo) : '';
                if (!assignee) {
                    return res.status(400).json({ success: false, message: 'Assignee email is required' });
                }

                const prevObEmail = normalizeEmail(previousTask.obManagerEmail);
                if (requesterEmail) {
                    updates.obManagerEmail = prevObEmail || requesterEmail;
                }

                const assignerEmail = normalizeEmail(previousTask.assignedBy);
                const assignerUser = assignerEmail ? await User.findOne({ email: assignerEmail }).select('role').lean() : null;
                const assignerRole = roleOf(assignerUser);
                if (assignerRole !== 'manager' && assignerRole !== 'md_manager') {
                    return res.status(403).json({ success: false, message: 'OB Manager can reassign only Manager/MD Manager tasks' });
                }

                const assigneeUser = await User.findOne({ email: assignee }).select('role').lean();
                const assigneeRole = roleOf(assigneeUser);
                if (!isAssistantRoleKey(assigneeRole)) {
                    return res.status(403).json({ success: false, message: 'OB Manager can assign tasks only to Assistant' });
                }
            } else if (keyuriOnlyTouchesAssignedTo) {
                if (!nextAssignedTo) {
                    return res.status(400).json({ success: false, message: 'Assignee email is required' });
                }

                if (isReassignment && RUTU_EMAIL && nextAssignedTo !== RUTU_EMAIL) {
                    const assigneeUser = await User.findOne({ email: nextAssignedTo }).select('role').lean();
                    const assigneeRole = roleOf(assigneeUser);
                    if (assigneeRole !== 'sub_assistance') {
                        return res.status(403).json({ success: false, message: 'You do not have permission to reassign tasks' });
                    }
                }
            } else {
                if (!canEditTaskDetails) {
                    return res.status(403).json({
                        success: false,
                        message: 'You are not authorized to update this task'
                    });
                }

                if ((requesterRole === 'manager' || requesterRole === 'md_manager') && Object.prototype.hasOwnProperty.call(updates || {}, 'assignedTo')) {
                    const nextAssigneeEmail = normalizeEmail(updates.assignedTo);
                    if (!nextAssigneeEmail) {
                        return res.status(400).json({ success: false, message: 'Assignee email is required' });
                    }

                    const assigneeUser = await User.findOne({ email: nextAssigneeEmail }).select('role').lean();
                    const assigneeRole = roleOf(assigneeUser);

                    const allowedForManager = assigneeRole === 'manager' || assigneeRole === 'ob_manager' || isAssistantRoleKey(assigneeRole);
                    const allowedForMdManager = allowedForManager || assigneeRole === 'md_manager';
                    const isAllowed = requesterRole === 'md_manager' ? allowedForMdManager : allowedForManager;

                    if (assigneeRole && !isAllowed) {
                        return res.status(403).json({
                            success: false,
                            message: 'Managers can assign tasks only to Manager/OB Manager/Assistant'
                        });
                    }

                    const nextTypeKey = (updates.taskType || updates.type || previousTask.taskType || '').toString().trim().toLowerCase();
                    const keyuriEmail = normalizeEmail('keyurismartbiz@gmail.com');
                    updates.obManagerEmail = assigneeRole === 'ob_manager'
                        ? nextAssigneeEmail
                        : (nextTypeKey === 'other work' && keyuriEmail && nextAssigneeEmail === keyuriEmail ? nextAssigneeEmail : null);
                }
            }
        } else {
            if (hasStatusKey) {
                const isObManager = requesterRole === 'ob_manager';
                if (isObManager || !isAssignee) {
                    return res.status(403).json({
                        success: false,
                        message: 'You are not authorized to update this task'
                    });
                }
            }

            if (hasApprovalKey && !(isAdmin || isAssigner)) {
                const wantsClearApproval = isPendingTransition && updates.completedApproval === false;
                if (!wantsClearApproval || !isAssignee) {
                    return res.status(403).json({
                        success: false,
                        message: 'You are not authorized to update this task'
                    });
                }
            }
        }

        const statusChanged = updates.status != null && String(updates.status) !== String(previousTask.status);
        if (statusChanged) {
            updates.statusUpdatedAt = Date.now();
        }

        const dueDateProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'dueDate');
        const nextDueDate = dueDateProvided ? (updates.dueDate ? new Date(updates.dueDate) : null) : null;
        const prevDueDate = previousTask?.dueDate ? new Date(previousTask.dueDate) : null;
        const nextDueMs = nextDueDate && !Number.isNaN(nextDueDate.getTime()) ? nextDueDate.getTime() : null;
        const prevDueMs = prevDueDate && !Number.isNaN(prevDueDate.getTime()) ? prevDueDate.getTime() : null;
        const dueDateChanged = dueDateProvided && nextDueMs !== prevDueMs;

        // Role based brand assignment logic (simplified for flexibility)
        const hasBrandChange = Boolean(updates.brandId || updates.brand || updates.companyName || updates.company);
        if (hasBrandChange) {
            const resolved = await resolveBrandFromRequest({
                brandId: updates.brandId || previousTask.brandId,
                brandName: updates.brand || previousTask.brand,
                companyName: updates.companyName || updates.company || previousTask.companyName
            });

            const resolvedBrandId = resolved.brandId ? resolved.brandId.toString() : '';
            updates.brandId = (resolvedBrandId && mongoose.Types.ObjectId.isValid(resolvedBrandId)) ? resolvedBrandId : null;
            updates.brand = (resolved.brand || '').toString();
            updates.companyName = (resolved.companyName || '').toString();
        }

        // Update the task
        const updatedTask = await Task.findByIdAndUpdate(
            id,
            {
                ...updates,
                updatedAt: Date.now()
            },
            {
                new: true,
                runValidators: true
            }
        );

        // ===== Audit / History (auto) =====
        try {
            const changes = {};
            const setChange = (field, from, to) => {
                const fromStr = from == null ? '' : String(from);
                const toStr = to == null ? '' : String(to);
                if (fromStr !== toStr) changes[field] = { from: fromStr, to: toStr };
            };

            if (updatedTask) {
                // Compare a few key fields
                setChange('title', previousTask.title, updatedTask.title);
                setChange('assignedTo', previousTask.assignedTo, updatedTask.assignedTo);
                setChange('priority', previousTask.priority, updatedTask.priority);
                setChange('taskType', previousTask.taskType, updatedTask.taskType);
                setChange('companyName', previousTask.companyName, updatedTask.companyName);
                setChange('brand', previousTask.brand, updatedTask.brand);
                setChange('status', previousTask.status, updatedTask.status);
                setChange('completedApproval', Boolean(previousTask.completedApproval), Boolean(updatedTask.completedApproval));

                // Dates
                const prevDue = previousTask.dueDate ? new Date(previousTask.dueDate).toISOString() : '';
                const nextDue = updatedTask.dueDate ? new Date(updatedTask.dueDate).toISOString() : '';
                if (prevDue !== nextDue) changes.dueDate = { from: prevDue, to: nextDue };

                const approvalChanged = Boolean(previousTask.completedApproval) !== Boolean(updatedTask.completedApproval);
                const statusChangedForAudit = String(previousTask.status) !== String(updatedTask.status);

                const nonStatusApprovalFields = Object.keys(changes).filter((k) => !['status', 'completedApproval'].includes(k));

                // Prefer a single history entry:
                // - If status changed (even if approval got cleared as part of pending transition), record only status.
                // - Else record approval changes.
                // - Else record field updates.
                if (isReassignment) {
                    await recordTaskReassigned({ req, previousTask, updatedTask, changes, note });
                } else if (statusChangedForAudit) {
                    await recordStatusChange({ req, previousTask, updatedTask, note, requestRecheck });
                } else if (approvalChanged) {
                    await recordApprovalChange({ req, previousTask, updatedTask, note });
                } else if (nonStatusApprovalFields.length > 0) {
                    await recordTaskUpdate({ req, previousTask, updatedTask, changes, note });
                }
            }
        } catch (auditError) {
            console.error('Audit history failed:', auditError);
        }

        await maybeAddBrandToAssignee({
            assignedToEmail: updatedTask?.assignedTo,
            brandId: updatedTask?.brandId
        });

        if ((statusChanged || dueDateChanged) && updatedTask?.googleSync?.taskId) {
            Promise.resolve()
                .then(async () => {
                    const tasksScope = 'https://www.googleapis.com/auth/tasks';

                    const ownerEmail = normalizeEmail(updatedTask?.googleSync?.ownerEmail)
                        || normalizeEmail(updatedTask?.assignedBy)
                        || normalizeEmail(updatedTask?.assignedTo);

                    if (!ownerEmail) {
                        throw new Error('Missing googleSync.ownerEmail');
                    }

                    const ownerUser = await User.findOne({ email: ownerEmail })
                        .select('email isGoogleCalendarConnected googleOAuth.refreshToken googleOAuth.scope')
                        .lean();

                    const refreshToken = ownerUser?.isGoogleCalendarConnected ? ownerUser?.googleOAuth?.refreshToken : null;
                    const scopes = Array.isArray(ownerUser?.googleOAuth?.scope) ? ownerUser.googleOAuth.scope : [];

                    if (!refreshToken) {
                        throw new Error('Google is not connected for the task owner');
                    }

                    if (!scopes.includes(tasksScope)) {
                        throw new Error('Google Tasks permission missing. Please reconnect Google.');
                    }

                    const tokenResponse = await refreshAccessToken(refreshToken);
                    const accessToken = tokenResponse?.access_token;
                    if (!accessToken) {
                        throw new Error('Failed to refresh access token');
                    }

                    const patch = {};

                    if (statusChanged) {
                        const desiredGoogleStatus = String(updatedTask.status || '').toLowerCase() === 'completed'
                            ? 'completed'
                            : 'needsAction';

                        const changedAt = updatedTask.statusUpdatedAt
                            ? new Date(updatedTask.statusUpdatedAt)
                            : new Date();

                        patch.status = desiredGoogleStatus;
                        if (desiredGoogleStatus === 'completed') {
                            patch.completed = changedAt.toISOString();
                        }
                    }

                    if (dueDateChanged) {
                        const dueDate = updatedTask?.dueDate ? new Date(updatedTask.dueDate) : null;
                        const due = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toISOString() : null;
                        patch.due = due;
                    }

                    const updatedGoogleTask = await updateGoogleTask({
                        accessToken,
                        tasklistId: updatedTask?.googleSync?.tasklistId || '@default',
                        taskId: updatedTask.googleSync.taskId,
                        patch
                    });

                    const googleUpdatedAt = updatedGoogleTask?.updated ? new Date(updatedGoogleTask.updated) : null;
                    await Task.findByIdAndUpdate(updatedTask._id, {
                        $set: {
                            'googleSync.ownerEmail': ownerEmail,
                            'googleSync.googleUpdatedAt': (googleUpdatedAt && !Number.isNaN(googleUpdatedAt.getTime())) ? googleUpdatedAt : null,
                            'googleSync.syncedAt': new Date(),
                            'googleSync.lastError': null
                        }
                    });
                })
                .catch((error) => {
                    const msg = error?.message || 'Failed to update Google Task';
                    Task.findByIdAndUpdate(updatedTask._id, {
                        $set: {
                            'googleSync.lastError': msg,
                            'googleSync.syncedAt': new Date()
                        }
                    }).catch(() => undefined);
                });
        }

        // Get user details for response
        let assignedToUser = null;
        let assignedByUser = null;

        if (typeof updatedTask.assignedTo === 'string') {
            assignedToUser = await User.findOne({ email: updatedTask.assignedTo });
        }

        if (typeof updatedTask.assignedBy === 'string') {
            assignedByUser = await User.findOne({ email: updatedTask.assignedBy });
        }

        const responseData = {
            ...updatedTask.toObject(),
            brand: await resolveBrandNameForTask(updatedTask),
            assignedToUser: assignedToUser ? {
                id: assignedToUser._id,
                name: assignedToUser.name,
                email: assignedToUser.email,
                avatar: assignedToUser.avatar,
                role: assignedToUser.role,
            } : { email: updatedTask.assignedTo },
            assignedByUser: assignedByUser ? {
                id: assignedByUser._id,
                name: assignedByUser.name,
                email: assignedByUser.email,
                avatar: assignedByUser.avatar,
                role: assignedByUser.role,
            } : { email: updatedTask.assignedBy }
        };

        try {
            emitTaskUpserted({
                ...responseData,
                id: responseData.id || responseData._id || updatedTask._id,
            });
        } catch (emitError) {
            console.error('emitTaskUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
        }

        return res.json({
            success: true,
            message: 'Task updated successfully',
            data: responseData
        });

    } catch (error) {
        console.error('Error updating task:', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating task',
            error: error.message
        });
    }
};

exports.getTaskReviews = async (req, res) => {
    try {
        const requesterRole = roleOf(req.user);
        const requesterEmail = normalizeEmail(req.user?.email);

        if (!canViewTaskReviews(req.user)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const status = String(req.query?.status || '').trim().toLowerCase();
        const reviewed = String(req.query?.reviewed || '').trim().toLowerCase();

        const query = { isDeleted: { $ne: true } };
        if (status) query.status = status;
        if (reviewed === 'true') query.reviewStars = { $ne: null };
        if (reviewed === 'false') query.reviewStars = null;

        let tasks = [];
        if (requesterRole === 'ob_manager') {
            const requesterId = safeObjectIdString(req.user?.id || req.user?._id || req.user?.userId);
            let requesterCompany = (req.user?.companyName || '').toString().trim();
            if (!requesterCompany && requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
                const doc = await User.findById(requesterId).select('companyName').lean();
                requesterCompany = (doc?.companyName || '').toString().trim();
            }

            const escapeRegex = (v) => String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const companySafe = requesterCompany ? escapeRegex(requesterCompany) : '';

            const assistantRoles = ['assistant', 'sub_assistance', 'sub_assistence', 'sub_assist', 'sub_assistant', 'manager', 'ob_manager'];
            const assistantDocs = companySafe
                ? await User.find({
                    companyName: { $regex: `^${companySafe}$`, $options: 'i' },
                    role: { $in: assistantRoles },
                    isDeleted: { $ne: true },
                }).select('email').lean()
                : [];

            const assistantEmails = (assistantDocs || [])
                .map((u) => normalizeEmail(u?.email))
                .filter(Boolean);

            if (assistantEmails.length === 0) {
                tasks = [];
            } else {
                tasks = await Task.find({
                    ...query,
                    assignedTo: { $in: assistantEmails }
                }).sort({ reviewedAt: -1, updatedAt: -1, createdAt: -1 }).lean();
            }
        } else if (isAssistantRoleKey(requesterRole)) {
            const requesterId = safeObjectIdString(req.user?.id || req.user?._id || req.user?.userId);
            let requesterCompany = (req.user?.companyName || '').toString().trim();
            if (!requesterCompany && requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
                const doc = await User.findById(requesterId).select('companyName').lean();
                requesterCompany = (doc?.companyName || '').toString().trim();
            }

            const escapeRegex = (v) => String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const companySafe = requesterCompany ? escapeRegex(requesterCompany) : '';

            const assistantRoles = ['assistant', 'sub_assistance', 'sub_assistence', 'sub_assist', 'sub_assistant'];
            const assistantDocs = companySafe
                ? await User.find({
                    companyName: { $regex: `^${companySafe}$`, $options: 'i' },
                    role: { $in: assistantRoles },
                    isDeleted: { $ne: true },
                }).select('email').lean()
                : [];

            const assistantEmails = (assistantDocs || [])
                .map((u) => normalizeEmail(u?.email))
                .filter(Boolean);

            const mergedEmails = Array.from(new Set([...(assistantEmails || []), requesterEmail].filter(Boolean)));
            if (mergedEmails.length === 0) {
                tasks = [];
            } else {
                tasks = await Task.find({
                    ...query,
                    assignedTo: { $in: mergedEmails }
                }).sort({ reviewedAt: -1, updatedAt: -1, createdAt: -1 }).lean();
            }
        } else if (requesterRole === 'manager' || requesterRole === 'md_manager') {
            const scope = await resolveTaskScopeEmails(req.user);
            const scopeEmails = Array.from(scope);

            const assistantRoles = ['assistant', 'sub_assistance', 'sub_assistence', 'sub_assist', 'sub_assistant'];
            const assistantDocs = await User.find({
                role: { $in: assistantRoles },
                isDeleted: { $ne: true },
            }).select('email').lean();
            const assistantEmails = (assistantDocs || [])
                .map((u) => normalizeEmail(u?.email))
                .filter(Boolean);

            const mergedEmails = Array.from(new Set([...(scopeEmails || []), ...(assistantEmails || [])].filter(Boolean)));
            console.log('Scope emails for role', requesterRole, ':', mergedEmails);

            if (mergedEmails.length === 0) {
                tasks = [];
            } else {
                tasks = await Task.find({
                    ...query,
                    $or: [
                        { assignedTo: { $in: mergedEmails } },
                        { assignedBy: { $in: mergedEmails } }
                    ]
                }).sort({ reviewedAt: -1, updatedAt: -1, createdAt: -1 }).lean();
            }
        } else {
            void requesterEmail;
            tasks = await Task.find(query).sort({ reviewedAt: -1, updatedAt: -1, createdAt: -1 }).lean();
        }

        const emails = Array.from(
            new Set(
                (tasks || [])
                    .flatMap((t) => [t?.assignedTo, t?.assignedBy, t?.reviewedBy])
                    .filter((e) => typeof e === 'string' && e.trim())
                    .map((e) => normalizeEmail(e))
                    .filter(Boolean)
            )
        );

        const users = emails.length
            ? await User.find({ email: { $in: emails } }).select('_id name email avatar role').lean()
            : [];
        const userByEmail = new Map(users.map((u) => [normalizeEmail(u.email), u]));

        const tasksWithUserDetails = (tasks || []).map((task) => {
            const assignedToUser = typeof task.assignedTo === 'string'
                ? userByEmail.get(normalizeEmail(task.assignedTo))
                : null;
            const assignedByUser = typeof task.assignedBy === 'string'
                ? userByEmail.get(normalizeEmail(task.assignedBy))
                : null;
            const reviewedByUser = typeof task.reviewedBy === 'string'
                ? userByEmail.get(normalizeEmail(task.reviewedBy))
                : null;

            return {
                ...task,
                id: task._id,
                assignedToUser: assignedToUser ? {
                    id: assignedToUser._id,
                    name: assignedToUser.name,
                    email: assignedToUser.email,
                    avatar: assignedToUser.avatar,
                    role: assignedToUser.role,
                } : { email: task.assignedTo },
                assignedByUser: assignedByUser ? {
                    id: assignedByUser._id,
                    name: assignedByUser.name,
                    email: assignedByUser.email,
                    avatar: assignedByUser.avatar,
                    role: assignedByUser.role,
                } : { email: task.assignedBy },
                reviewedByUser: reviewedByUser ? {
                    id: reviewedByUser._id,
                    name: reviewedByUser.name,
                    email: reviewedByUser.email,
                    avatar: reviewedByUser.avatar,
                    role: reviewedByUser.role,
                } : (task.reviewedBy ? { email: task.reviewedBy } : null),
            };
        });

        return res.json({
            success: true,
            message: 'Reviews fetched successfully',
            data: tasksWithUserDetails
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error fetching reviews', error: error.message });
    }
};

exports.submitTaskReview = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid task id' });
        }

        if (!canSubmitTaskReview(req.user)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const starsRaw = req.body?.reviewStars;
        const commentRaw = req.body?.reviewComment;
        const stars = Number(starsRaw);
        const comment = (commentRaw || '').toString().trim();

        if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
            return res.status(400).json({ success: false, message: 'reviewStars must be between 1 and 5' });
        }

        const task = await Task.findById(id);
        if (!task || task.isDeleted) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        const requesterEmail = normalizeEmail(req.user?.email);
        const requesterRole = roleOf(req.user);
        const isAdmin = requesterRole === 'admin' || requesterRole === 'super_admin';
        const isAssigner = requesterEmail && normalizeEmail(task.assignedBy) === requesterEmail;

        if (!isAdmin && !isAssigner) {
            return res.status(403).json({ success: false, message: 'Only task assigner can submit review' });
        }

        if (String(task.status || '').toLowerCase() !== 'completed') {
            return res.status(400).json({ success: false, message: 'Only completed tasks can be reviewed' });
        }

        const previousStars = task.reviewStars;
        const updated = await Task.findByIdAndUpdate(
            id,
            {
                $set: {
                    reviewStars: stars,
                    reviewComment: comment,
                    reviewedBy: requesterEmail,
                    reviewedAt: new Date(),
                    updatedAt: Date.now()
                }
            },
            { new: true }
        );

        try {
            const actor = getActorFromRequest(req);
            await TaskHistory.create({
                taskId: id,
                action: 'task_reviewed',
                message: previousStars == null
                    ? `Task reviewed (${stars}/5) by ${actor.name}`
                    : `Task review updated (${stars}/5) by ${actor.name}`,
                oldStatus: task.status || null,
                newStatus: task.status || null,
                note: comment,
                userId: actor.id,
                user: {
                    userId: actor.id,
                    userName: actor.name,
                    userEmail: actor.email,
                    userRole: actor.role
                },
                additionalData: {
                    reviewStars: stars,
                    previousReviewStars: previousStars,
                }
            });
        } catch (auditError) {
            console.error('Review history failed:', auditError);
        }

        return res.json({
            success: true,
            message: 'Review saved successfully',
            data: updated
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Error saving review', error: error.message });
    }
};

exports.syncTaskToGoogle = async (req, res) => {
    try {
        const { taskId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(taskId)) {
            return res.status(400).json({ success: false, message: 'Invalid task id' });
        }

        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (task.isDeleted) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        if (!await userCanAccessTask(task, req.user)) {
            return res.status(403).json({ success: false, message: 'You are not authorized to sync this task' });
        }

        const tasksScope = 'https://www.googleapis.com/auth/tasks';

        const requesterId = (req.user?.id || req.user?._id || req.user?.userId || '').toString();
        const requester = (requesterId && mongoose.Types.ObjectId.isValid(requesterId))
            ? await User.findById(requesterId)
                .select('isGoogleCalendarConnected googleOAuth.refreshToken googleOAuth.scope email')
                .lean()
            : null;

        const assignedByEmail = normalizeEmail(task.assignedBy);
        const assignedToEmail = normalizeEmail(task.assignedTo);
        const ownerEmail = normalizeEmail(task?.googleSync?.ownerEmail);

        const assignedByUser = assignedByEmail
            ? await User.findOne({ email: assignedByEmail })
                .select('isGoogleCalendarConnected googleOAuth.refreshToken googleOAuth.scope email')
                .lean()
            : null;

        const assignedToUser = assignedToEmail
            ? await User.findOne({ email: assignedToEmail })
                .select('isGoogleCalendarConnected googleOAuth.refreshToken googleOAuth.scope email')
                .lean()
            : null;

        const ownerUser = ownerEmail
            ? await User.findOne({ email: ownerEmail })
                .select('isGoogleCalendarConnected googleOAuth.refreshToken googleOAuth.scope email')
                .lean()
            : null;

        const ownerToken = ownerUser?.isGoogleCalendarConnected ? ownerUser?.googleOAuth?.refreshToken : null;
        const requesterToken = requester?.isGoogleCalendarConnected ? requester?.googleOAuth?.refreshToken : null;
        const assignerToken = assignedByUser?.isGoogleCalendarConnected ? assignedByUser?.googleOAuth?.refreshToken : null;
        const assigneeToken = assignedToUser?.isGoogleCalendarConnected ? assignedToUser?.googleOAuth?.refreshToken : null;

        const refreshToken = ownerToken || requesterToken || assignerToken || assigneeToken;
        const scope = (ownerToken ? ownerUser?.googleOAuth?.scope : null)
            || (requesterToken ? requester?.googleOAuth?.scope : null)
            || (assignerToken ? assignedByUser?.googleOAuth?.scope : null)
            || (assigneeToken ? assignedToUser?.googleOAuth?.scope : null)
            || [];

        const tokenOwnerEmail = normalizeEmail(
            ownerUser?.email
            || requester?.email
            || assignedByUser?.email
            || assignedToUser?.email
            || task?.googleSync?.ownerEmail
            || ''
        );

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Google is not connected for any available user. Please connect Google Tasks first.'
            });
        }

        if (!Array.isArray(scope) || !scope.includes(tasksScope)) {
            return res.status(400).json({
                success: false,
                message: 'Google is connected but missing Google Tasks permission. Please disconnect and connect Google again.'
            });
        }

        const toGoogleStatus = (dbStatus) => (String(dbStatus || '').toLowerCase() === 'completed' ? 'completed' : 'needsAction');

        const isGoogleNotFoundError = (error) => {
            const statusCode = error?.statusCode;
            const responseBody = error?.responseBody;
            const apiStatus = responseBody?.error?.status;
            const apiCode = responseBody?.error?.code;
            return statusCode === 404 || apiStatus === 'NOT_FOUND' || apiCode === 404;
        };

        const tokenResponse = await refreshAccessToken(refreshToken);
        const accessToken = tokenResponse?.access_token;
        if (!accessToken) {
            throw new Error('Failed to refresh access token');
        }

        const desiredStatus = toGoogleStatus(task.status);
        const patch = { status: desiredStatus };

        if (desiredStatus === 'completed') {
            patch.completed = (task.statusUpdatedAt ? new Date(task.statusUpdatedAt) : new Date()).toISOString();
        }

        const dueDate = task?.dueDate ? new Date(task.dueDate) : null;
        const due = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toISOString() : null;
        patch.due = due;

        if (task?.googleSync?.taskId) {
            let updatedGoogleTask;
            try {
                updatedGoogleTask = await updateGoogleTask({
                    accessToken,
                    tasklistId: task?.googleSync?.tasklistId || '@default',
                    taskId: task.googleSync.taskId,
                    patch
                });
            } catch (error) {
                if (!isGoogleNotFoundError(error)) {
                    throw error;
                }

                await Task.findByIdAndUpdate(task._id, {
                    $set: {
                        'googleSync.taskId': null,
                        'googleSync.tasklistId': '@default',
                        'googleSync.googleUpdatedAt': null,
                        'googleSync.lastError': null,
                        'googleSync.syncedAt': new Date(),
                        'googleSync.ownerEmail': tokenOwnerEmail
                    }
                });

                const attendeeEmails = [normalizeEmail(task.assignedTo)].filter(Boolean);
                const googleTask = await createTaskCalendarInvite({
                    refreshToken,
                    task,
                    attendeeEmails
                });

                const recreatedUpdatedAt = googleTask?.updated ? new Date(googleTask.updated) : null;
                await Task.findByIdAndUpdate(task._id, {
                    $set: {
                        'googleSync.taskId': googleTask?.id || null,
                        'googleSync.tasklistId': '@default',
                        'googleSync.ownerEmail': tokenOwnerEmail,
                        'googleSync.syncedAt': new Date(),
                        'googleSync.googleUpdatedAt': (recreatedUpdatedAt && !Number.isNaN(recreatedUpdatedAt.getTime())) ? recreatedUpdatedAt : null,
                        'googleSync.lastError': null
                    }
                });

                return res.status(200).json({
                    success: true,
                    message: 'Google Task was missing and has been recreated successfully',
                    data: {
                        taskId: task._id,
                        googleTask
                    }
                });
            }

            const googleUpdatedAt = updatedGoogleTask?.updated ? new Date(updatedGoogleTask.updated) : null;
            await Task.findByIdAndUpdate(task._id, {
                $set: {
                    'googleSync.ownerEmail': tokenOwnerEmail,
                    'googleSync.syncedAt': new Date(),
                    'googleSync.googleUpdatedAt': (googleUpdatedAt && !Number.isNaN(googleUpdatedAt.getTime())) ? googleUpdatedAt : null,
                    'googleSync.lastError': null
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Google Task updated successfully',
                data: {
                    taskId: task._id,
                    googleTask: updatedGoogleTask
                }
            });
        }

        const attendeeEmails = [normalizeEmail(task.assignedTo)].filter(Boolean);
        const googleTask = await createTaskCalendarInvite({
            refreshToken,
            task,
            attendeeEmails
        });

        const googleUpdatedAt = googleTask?.updated ? new Date(googleTask.updated) : null;
        await Task.findByIdAndUpdate(task._id, {
            $set: {
                'googleSync.taskId': googleTask?.id || null,
                'googleSync.tasklistId': '@default',
                'googleSync.ownerEmail': tokenOwnerEmail,
                'googleSync.syncedAt': new Date(),
                'googleSync.googleUpdatedAt': (googleUpdatedAt && !Number.isNaN(googleUpdatedAt.getTime())) ? googleUpdatedAt : null,
                'googleSync.lastError': null
            }
        });

        return res.status(200).json({
            success: true,
            message: 'Google Task created successfully',
            data: {
                taskId: task._id,
                googleTask
            }
        });
    } catch (error) {
        const statusCode = error?.statusCode || 500;
        const responseBody = error?.responseBody;

        const googleMessage =
            (responseBody && typeof responseBody === 'object' && responseBody.error && responseBody.error.message)
                ? responseBody.error.message
                : (error?.message || 'Error syncing task to Google');

        console.error('Error syncing task to Google:', {
            statusCode,
            message: error?.message,
            responseBody
        });

        if (statusCode === 401 || statusCode === 403) {
            return res.status(statusCode).json({
                success: false,
                message: 'Google authorization failed. Please disconnect and connect Google again.',
                error: googleMessage,
                details: responseBody || null
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Error syncing task to Google',
            error: googleMessage,
            details: responseBody || null
        });
    }
};

exports.approveTask = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user || {};

        const approveValue = typeof req.body?.approve === 'boolean' ? req.body.approve : true;

        const task = await Task.findById(id);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        // Check if user is admin or assigner
        const isAdmin = user.role === 'admin' || user.role === 'super_admin';
        const isAssigner = task.assignedBy === user.email;

        if (!isAdmin && !isAssigner) {
            return res.status(403).json({
                success: false,
                message: 'Only admin or task assigner can approve tasks'
            });
        }

        const previousTask = task;
        const updatedTask = await Task.findByIdAndUpdate(
            id,
            {
                completedApproval: approveValue,
                updatedAt: Date.now()
            },
            { new: true }
        );

        try {
            if (updatedTask) {
                await recordApprovalChange({ req, previousTask, updatedTask, note: '' });
            }
        } catch (auditError) {
            console.error('Audit approval failed:', auditError);
        }
        
        res.json({
            success: true,
            message: approveValue ? 'Task approved successfully' : 'Task approval removed',
            data: updatedTask
        });
        
    } catch (error) {
        console.error('Error approving task:', error);
        res.status(500).json({
            success: false,
            message: 'Error approving task',
            error: error.message
        });
    }
};

// controllers/task.controller.js में ये function add करें (अगर नहीं है):

exports.deleteTask = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user || {};
        
        console.log(`Attempting to delete task ${id} by user ${user.email}`);
        
        // Find the task first
        const task = await Task.findById(id);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        if (task.isDeleted) {
            return res.json({
                success: true,
                message: 'Task deleted successfully'
            });
        }
        
        // Check permissions
        const isAdmin = roleOf(user) === 'admin' || roleOf(user) === 'super_admin';
        const isAssigner = normalizeEmail(task.assignedBy) === normalizeEmail(user.email);
        
        if (!isAdmin && !isAssigner) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to delete this task'
            });
        }

        try {
            await recordTaskDeleted({ req, task, note: '' });
        } catch (auditError) {
            console.error('Audit delete failed:', auditError);
        }

        try {
            const googleTaskId = task?.googleSync?.taskId;
            if (googleTaskId) {
                const tasksScope = 'https://www.googleapis.com/auth/tasks';
                const ownerEmail = normalizeEmail(task?.googleSync?.ownerEmail)
                    || normalizeEmail(task?.assignedBy)
                    || normalizeEmail(task?.assignedTo);

                if (ownerEmail) {
                    const ownerUser = await User.findOne({ email: ownerEmail })
                        .select('email isGoogleCalendarConnected googleOAuth.refreshToken googleOAuth.scope')
                        .lean();

                    const refreshToken = ownerUser?.isGoogleCalendarConnected ? ownerUser?.googleOAuth?.refreshToken : null;
                    const scopes = Array.isArray(ownerUser?.googleOAuth?.scope) ? ownerUser.googleOAuth.scope : [];

                    if (refreshToken && scopes.includes(tasksScope)) {
                        const tokenResponse = await refreshAccessToken(refreshToken);
                        const accessToken = tokenResponse?.access_token;

                        if (accessToken) {
                            try {
                                await deleteGoogleTask({
                                    accessToken,
                                    tasklistId: task?.googleSync?.tasklistId || '@default',
                                    taskId: googleTaskId
                                });
                            } catch (googleDeleteError) {
                                const statusCode = googleDeleteError?.statusCode;
                                if (statusCode !== 404) {
                                    throw googleDeleteError;
                                }
                            }
                        }
                    }
                }
            }
        } catch (googleError) {
            console.error('Google task delete failed:', googleError?.message || googleError);
        }

        await Task.findByIdAndUpdate(id, {
            $set: {
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: normalizeEmail(user.email),
                updatedAt: Date.now()
            }
        });
        
        console.log(`Task ${id} deleted successfully`);
        
        res.json({
            success: true,
            message: 'Task deleted successfully'
        });
        
    } catch (error) {
        console.error('Error deleting task:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting task',
            error: error.message
        });
    }
};