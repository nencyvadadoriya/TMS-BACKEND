// controllers/task.controller.js
const mongoose = require('mongoose');
const Task = require('../model/Task.model');
const Brand = require('../model/Brand.model');
const User = require('../model/user.model');
const Comment = require('../model/Comment.model');
const TaskHistory = require('../model/TaskHistory.model');
const { createTaskCalendarInvite, refreshAccessToken, updateGoogleTask, deleteGoogleTask } = require('../utils/googleCalendar.util');
const { sendTaskAssignedEmail } = require('../middleware/email.message');
const {
    recordStatusChange,
    recordApprovalChange,
    recordTaskUpdate,
    recordTaskDeleted
} = require('../utils/taskAudit.util');

const normalizeEmail = (email) => (email || '').toString().trim().toLowerCase();

const roleOf = (user) => String(user?.role || '').toLowerCase();

const getActorFromRequest = (req) => {
    const user = req.user || {};

    const actorId = user.id || user._id || user.userId;
    return {
        id: actorId ? actorId.toString() : 'system',
        name: user.name || 'System',
        email: user.email || 'system@task-app.local',
        role: user.role || 'system'
    };
};

const isSameDay = (a, b) => {
    try {
        const d1 = new Date(a);
        const d2 = new Date(b);
        return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
    } catch {
        return false;
    }
};

const userIsTaskAssigner = (task, user) => {
    if (!user || !task) return false;
    const email = normalizeEmail(user.email);
    return email && normalizeEmail(task.assignedBy) === email;
};

const userCanAccessTask = (task, user) => {
    if (!user || !task) return false;
    if (roleOf(user) === 'admin') return true;
    const email = normalizeEmail(user.email);
    return email && (normalizeEmail(task.assignedTo) === email || normalizeEmail(task.assignedBy) === email);
};

const managerAllowedBrandIdSet = async (user) => {
    const actorId = (user?.id || user?._id || user?.userId || '').toString();
    if (!actorId || !mongoose.Types.ObjectId.isValid(actorId)) return new Set();

    const dbUser = await User.findById(actorId).select('assignedBrandIds').lean();
    const ids = Array.isArray(dbUser?.assignedBrandIds) ? dbUser.assignedBrandIds.map(String) : [];
    return new Set(ids);
};

const resolveBrandFromRequest = async ({ brandId, brandName, companyName }) => {
    const id = brandId ? brandId.toString() : '';
    if (id && mongoose.Types.ObjectId.isValid(id)) {
        const doc = await Brand.findById(id).select('name company owner').lean();
        if (doc) {
            return {
                brandId: doc._id,
                brand: (doc.name || '').toString(),
                companyName: (doc.company || companyName || '').toString(),
                owner: doc.owner || null
            };
        }
    }

    const name = (brandName || '').toString().trim();
    const company = (companyName || '').toString().trim();
    if (!name) {
        return { brandId: null, brand: '', companyName: company, owner: null };
    }

    const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const safeCompany = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = company
        ? { name: { $regex: `^${safeName}$`, $options: 'i' }, company: { $regex: `^${safeCompany}$`, $options: 'i' } }
        : { name: { $regex: `^${safeName}$`, $options: 'i' } };

    const doc = await Brand.findOne(query).select('name company owner').lean();
    if (!doc) {
        return { brandId: null, brand: name, companyName: company, owner: null };
    }

    return {
        brandId: doc._id,
        brand: (doc.name || name).toString(),
        companyName: (doc.company || company).toString(),
        owner: doc.owner || null
    };
};

const resolveBrandNameForTask = async (task) => {
    try {
        const existing = (task?.brand || '').toString().trim();
        if (existing) return existing;

        const brandId = task?.brandId ? task.brandId.toString() : '';
        if (!brandId || !mongoose.Types.ObjectId.isValid(brandId)) return '';

        const brandDoc = await Brand.findById(brandId).select('name').lean();
        return (brandDoc?.name || '').toString().trim();
    } catch {
        return (task?.brand || '').toString().trim();
    }
};

const maybeAddBrandToAssignee = async ({ assignedToEmail, brandId }) => {
    try {
        const email = normalizeEmail(assignedToEmail);
        const id = brandId ? brandId.toString() : '';

        if (!email) return;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) return;

        const assignee = await User.findOne({ email }).select('_id role assignedBrandIds').lean();
        const role = roleOf(assignee);
        if (role !== 'assistant' && role !== 'manager') return;

        await User.findByIdAndUpdate(assignee._id, {
            $addToSet: { assignedBrandIds: id }
        });
    } catch {
        return;
    }
};

const formatOverdueDuration = (ms) => {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalMinutes = Math.floor(safeMs / (60 * 1000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    return { days, hours, minutes };
};

exports.addTask = async (req, res) => {
    try {
        console.log(" Task creation request body:", req.body);

        const {
            title,
            assignedTo,
            dueDate,
            priority = 'medium',
            taskType = 'regular',
            type,
            companyName,
            company,
            brand = '',
            brandId = null,
            status = 'pending'
        } = req.body;

        // Always take assignedBy from authenticated user to prevent spoofing
        const assignedBy = (req.user && req.user.email) ? req.user.email : 'admin@example.com';

        const normalizedAssignedTo = normalizeEmail(assignedTo);
        const normalizedAssignedBy = normalizeEmail(assignedBy);

        // Validation
        if (!title || !normalizedAssignedTo || !dueDate) {
            return res.status(400).json({
                success: false,
                message: 'Title, assignee email, and due date are required'
            });
        }

        // Optional: Check if assignedTo email exists in users
        try {
            const assignedUser = await User.findOne({ email: normalizedAssignedTo });
            if (!assignedUser) {
                console.log(` Warning: User with email ${normalizedAssignedTo} not found in database`);
            }
        } catch (userError) {
            console.log("User check skipped or failed:", userError.message);
        }

        const requesterRole = roleOf(req.user);

        // Create new task object
        const effectiveCompanyName = (companyName || company || '').toString();
        const effectiveTaskType = (taskType || type || 'regular').toString();

        // Enforce manager restrictions
        if (requesterRole === 'manager') {

            const normalizedType = effectiveTaskType.toString().trim().toLowerCase();
            if (normalizedType === 'company') {
                return res.status(403).json({
                    success: false,
                    message: 'Managers cannot assign company-level tasks'
                });
            }

            const resolved = await resolveBrandFromRequest({
                brandId,
                brandName: brand,
                companyName: effectiveCompanyName
            });

            const allowedBrandIds = await managerAllowedBrandIdSet(req.user);
            const resolvedBrandId = resolved.brandId ? resolved.brandId.toString() : '';
            const requesterId = (req.user?.id || req.user?._id || req.user?.userId || '').toString();
            const isOwner = requesterId && resolved?.owner && resolved.owner.toString() === requesterId;

            if (!resolvedBrandId || !mongoose.Types.ObjectId.isValid(resolvedBrandId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Managers must assign tasks to an allowed brand'
                });
            }

            if (!allowedBrandIds.has(resolvedBrandId) && !isOwner) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not allowed to assign tasks for this brand'
                });
            }

            if (isOwner && requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
                await User.findByIdAndUpdate(requesterId, {
                    $addToSet: { assignedBrandIds: resolvedBrandId }
                });
            }

            // Force canonical brand/company fields from Brand document
            req.body.brandId = resolved.brandId;
            req.body.brand = resolved.brand;
            req.body.companyName = resolved.companyName;
        }

        const finalCompanyName = (req.body.companyName || effectiveCompanyName || '').toString();
        const finalBrand = (req.body.brand || brand || '').toString();
        const finalBrandId = req.body.brandId != null ? req.body.brandId : brandId;

        const newTask = new Task({
            title,
            assignedTo: normalizedAssignedTo, // Email store ho jayegi
            assignedBy: normalizedAssignedBy, // Email store ho jayegi
            dueDate: new Date(dueDate),
            priority,
            taskType: effectiveTaskType,
            companyName: finalCompanyName,
            brand: finalBrand,
            brandId: finalBrandId || null,
            status
        });

        console.log(" New task object:", newTask);

        // Save to database
        const savedTask = await newTask.save();
        console.log(" Task saved successfully:", savedTask._id);

        try {
            const actor = getActorFromRequest(req);
            const historyEntry = await TaskHistory.create({
                taskId: savedTask._id,
                action: 'task_created',
                message: `Task created by ${actor.name} (${actor.role})`,
                oldStatus: null,
                newStatus: savedTask.status || null,
                note: '',
                additionalData: {
                    title: savedTask.title,
                    assignedTo: savedTask.assignedTo,
                    assignedBy: savedTask.assignedBy,
                    dueDate: savedTask.dueDate ? new Date(savedTask.dueDate).toISOString() : null,
                    priority: savedTask.priority,
                    taskType: savedTask.taskType,
                    companyName: savedTask.companyName,
                    brand: savedTask.brand,
                    brandId: savedTask.brandId ? savedTask.brandId.toString() : null
                },
                userId: actor.id,
                user: {
                    userId: actor.id,
                    userName: actor.name,
                    userEmail: actor.email,
                    userRole: actor.role
                }
            });

            await Task.findByIdAndUpdate(savedTask._id, {
                $addToSet: { history: historyEntry._id }
            });
        } catch (historyError) {
            console.error('Error creating task history:', historyError);
        }

        await maybeAddBrandToAssignee({
            assignedToEmail: savedTask.assignedTo,
            brandId: savedTask.brandId
        });

        // Since assignedTo is now String/email, we can't use populate directly
        // Manually fetch user details if needed
        let assignedToUser = null;
        let assignedByUser = null;

        try {
            assignedToUser = await User.findOne({ email: normalizedAssignedTo });
            assignedByUser = await User.findOne({ email: normalizedAssignedBy });
        } catch (userError) {
            console.log("User lookup failed:", userError.message);
        }

        const canUseAssignerToken =
            assignedByUser &&
            assignedByUser.isGoogleCalendarConnected &&
            assignedByUser.googleOAuth &&
            assignedByUser.googleOAuth.refreshToken;

        const canUseAssigneeToken =
            assignedToUser &&
            assignedToUser.isGoogleCalendarConnected &&
            assignedToUser.googleOAuth &&
            assignedToUser.googleOAuth.refreshToken;

        const taskAttendees = [normalizedAssignedTo].filter(Boolean);

        if (canUseAssignerToken) {
            Promise.resolve()
                .then(async () => {
                    const googleTask = await createTaskCalendarInvite({
                        refreshToken: assignedByUser.googleOAuth.refreshToken,
                        task: savedTask,
                        attendeeEmails: taskAttendees
                    });

                    const googleUpdatedAt = googleTask?.updated ? new Date(googleTask.updated) : null;
                    await Task.findByIdAndUpdate(savedTask._id, {
                        $set: {
                            'googleSync.taskId': googleTask?.id || null,
                            'googleSync.tasklistId': '@default',
                            'googleSync.ownerEmail': normalizeEmail(assignedByUser?.email || normalizedAssignedBy),
                            'googleSync.syncedAt': new Date(),
                            'googleSync.googleUpdatedAt': (googleUpdatedAt && !Number.isNaN(googleUpdatedAt.getTime())) ? googleUpdatedAt : null,
                            'googleSync.lastError': null
                        }
                    });

                    console.log('Google Task created (assigner):', {
                        taskId: savedTask?._id?.toString?.() || savedTask?._id,
                        googleTaskId: googleTask?.id
                    });
                })
                .catch((error) => {
                    console.error('Google Task creation failed (assigner):', error?.message || error);
                    Task.findByIdAndUpdate(savedTask._id, {
                        $set: {
                            'googleSync.lastError': error?.message || 'Google Task creation failed',
                            'googleSync.syncedAt': new Date(),
                            'googleSync.ownerEmail': normalizeEmail(assignedByUser?.email || normalizedAssignedBy)
                        }
                    }).catch(() => undefined);
                });
        } else if (canUseAssigneeToken) {
            Promise.resolve()
                .then(async () => {
                    const googleTask = await createTaskCalendarInvite({
                        refreshToken: assignedToUser.googleOAuth.refreshToken,
                        task: savedTask,
                        attendeeEmails: taskAttendees
                    });

                    const googleUpdatedAt = googleTask?.updated ? new Date(googleTask.updated) : null;
                    await Task.findByIdAndUpdate(savedTask._id, {
                        $set: {
                            'googleSync.taskId': googleTask?.id || null,
                            'googleSync.tasklistId': '@default',
                            'googleSync.ownerEmail': normalizeEmail(assignedToUser?.email || normalizedAssignedTo),
                            'googleSync.syncedAt': new Date(),
                            'googleSync.googleUpdatedAt': (googleUpdatedAt && !Number.isNaN(googleUpdatedAt.getTime())) ? googleUpdatedAt : null,
                            'googleSync.lastError': null
                        }
                    });

                    console.log('Google Task created (assignee):', {
                        taskId: savedTask?._id?.toString?.() || savedTask?._id,
                        googleTaskId: googleTask?.id
                    });
                })
                .catch((error) => {
                    console.error('Google Task creation failed (assignee):', error?.message || error);
                    Task.findByIdAndUpdate(savedTask._id, {
                        $set: {
                            'googleSync.lastError': error?.message || 'Google Task creation failed',
                            'googleSync.syncedAt': new Date(),
                            'googleSync.ownerEmail': normalizeEmail(assignedToUser?.email || normalizedAssignedTo)
                        }
                    }).catch(() => undefined);
                });
        }

        // Prepare response with user details
        const resolvedBrandName = await resolveBrandNameForTask(savedTask);
        const responseData = {
            ...savedTask.toObject(),
            brand: resolvedBrandName || (savedTask.brand || ''),
            assignedToUser: assignedToUser ? {
                id: assignedToUser._id,
                name: assignedToUser.name,
                email: assignedToUser.email,
            } : { email: assignedTo },
            assignedByUser: assignedByUser ? {
                id: assignedByUser._id,
                name: assignedByUser.name,
                email: assignedByUser.email,
            } : { email: assignedBy }
        };

        Promise.resolve()
            .then(async () => {
                const toName = assignedToUser?.name || 'User';
                const assignedByName = assignedByUser?.name || req.user?.name || 'User';
                const assignedByEmailSafe = normalizeEmail(req.user?.email || assignedByUser?.email || savedTask.assignedBy);

                await sendTaskAssignedEmail({
                    toEmail: savedTask.assignedTo,
                    toName,
                    assignedByName,
                    assignedByEmail: assignedByEmailSafe,
                    task: {
                        title: savedTask.title,
                        priority: savedTask.priority,
                        status: savedTask.status,
                        companyName: savedTask.companyName,
                        brand: resolvedBrandName || savedTask.brand,
                        dueDate: savedTask.dueDate
                    }
                });
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
        console.error(' Error creating task:', error);
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

        let tasks;
        if (requesterRole === 'admin') {
            tasks = await Task.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean();
        } else {
            tasks = await Task.find({
                isDeleted: { $ne: true },
                $or: [
                    { assignedTo: requesterEmail },
                    { assignedBy: requesterEmail }
                ]
            }).sort({ createdAt: -1 }).lean();
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
                    .select('_id name email avatar')
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
                    avatar: assignedToUser.avatar
                } : { email: task.assignedTo },
                assignedByUser: assignedByUser ? {
                    id: assignedByUser._id,
                    name: assignedByUser.name,
                    email: assignedByUser.email,
                    avatar: assignedByUser.avatar
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
        return res.status(500).json({
            success: false,
            message: 'Error fetching tasks',
            error: error.message
        });
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

        if (!userCanAccessTask(task, req.user)) {
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
                    avatar: assignedToUser.avatar
                } : { email: task.assignedTo },
                assignedByUser: assignedByUser ? {
                    id: assignedByUser._id,
                    name: assignedByUser.name,
                    email: assignedByUser.email,
                    avatar: assignedByUser.avatar
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

        if (!userCanAccessTask(task, req.user)) {
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

        if (!userCanAccessTask(task, req.user)) {
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

        if (!userCanAccessTask(task, req.user)) {
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

        if (!userCanAccessTask(task, req.user)) {
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

        if (!userCanAccessTask(task, req.user)) {
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

        if (!userCanAccessTask(task, req.user)) {
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
        return res.status(500).json({ success: false, message: 'Failed to invite user', error: error.message });
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
        const isAdmin = requesterRole === 'admin';
        const requesterEmail = normalizeEmail(req.user?.email);
        const isAssigner = userIsTaskAssigner(previousTask, req.user);
        const isAssignee = requesterEmail && normalizeEmail(previousTask.assignedTo) === requesterEmail;

        const hasStatusKey = Object.prototype.hasOwnProperty.call(updates || {}, 'status');
        const hasApprovalKey = Object.prototype.hasOwnProperty.call(updates || {}, 'completedApproval');

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

        // Permissions:
        // - Assignee can update status (complete/pending)
        // - Admin can update status and approval
        // - Only assigner can update other fields (edit task details)
        if (otherUpdateKeys.length > 0) {
            if (!isAssigner) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not authorized to update this task'
                });
            }
        } else {
            if (hasStatusKey && !(isAdmin || isAssigner || isAssignee)) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not authorized to update this task'
                });
            }

            if (hasApprovalKey && !(isAdmin || isAssigner)) {
                // Allow assignee to clear approval only when moving to pending
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

        if (requesterRole === 'manager' && otherUpdateKeys.length > 0) {

            const nextTaskType = (updates.taskType || updates.type || previousTask.taskType || '').toString().trim().toLowerCase();
            if (nextTaskType === 'company') {
                return res.status(403).json({
                    success: false,
                    message: 'Managers cannot assign company-level tasks'
                });
            }

            const hasBrandChange = Boolean(updates.brandId || updates.brand || updates.companyName || updates.company);
            if (hasBrandChange) {
                const resolved = await resolveBrandFromRequest({
                    brandId: updates.brandId || previousTask.brandId,
                    brandName: updates.brand || previousTask.brand,
                    companyName: updates.companyName || updates.company || previousTask.companyName
                });

                const allowedBrandIds = await managerAllowedBrandIdSet(req.user);
                const resolvedBrandId = resolved.brandId ? resolved.brandId.toString() : '';

                if (!resolvedBrandId || !mongoose.Types.ObjectId.isValid(resolvedBrandId)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Managers must assign tasks to an allowed brand'
                    });
                }

                if (!allowedBrandIds.has(resolvedBrandId)) {
                    return res.status(403).json({
                        success: false,
                        message: 'You are not allowed to assign tasks for this brand'
                    });
                }

                updates.brandId = resolved.brandId;
                updates.brand = resolved.brand;
                updates.companyName = resolved.companyName;
            }
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
                const statusChanged = String(previousTask.status) !== String(updatedTask.status);

                const nonStatusApprovalFields = Object.keys(changes).filter((k) => !['status', 'completedApproval'].includes(k));

                // Prefer a single history entry:
                // - If status changed (even if approval got cleared as part of pending transition), record only status.
                // - Else record approval changes.
                // - Else record field updates.
                if (statusChanged) {
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
                avatar: assignedToUser.avatar
            } : { email: updatedTask.assignedTo },
            assignedByUser: assignedByUser ? {
                id: assignedByUser._id,
                name: assignedByUser.name,
                email: assignedByUser.email,
                avatar: assignedByUser.avatar
            } : { email: updatedTask.assignedBy }
        };

        res.json({
            success: true,
            message: 'Task updated successfully',
            data: responseData
        });

    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating task',
            error: error.message
        });
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

        if (!userCanAccessTask(task, req.user)) {
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
        const isAdmin = user.role === 'admin';
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
        const isAdmin = roleOf(user) === 'admin';
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