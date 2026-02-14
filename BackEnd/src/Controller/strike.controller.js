const mongoose = require('mongoose');

const Strike = require('../model/Strike.model');
const Task = require('../model/Task.model');
const User = require('../model/user.model');

const normalizeText = (v) => (v == null ? '' : String(v)).trim();
const normalizeCompanyKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '');

const getActorFromRequest = (req) => {
    const id = (() => {
        const raw = req.user?.id || req.user?._id || req.user?.userId;
        try {
            return raw == null ? '' : String(raw);
        } catch {
            return '';
        }
    })();

    const email = normalizeText(req.user?.email).toLowerCase();

    return {
        id,
        name: normalizeText(req.user?.name || 'User'),
        email,
        role: normalizeText(req.user?.role || '').toLowerCase()
    };
};

const isOverdueTask = (task) => {
    try {
        if (!task?.dueDate) return false;
        const status = normalizeText(task?.status).toLowerCase();
        if (status === 'completed') return false;

        const due = new Date(task.dueDate);
        if (Number.isNaN(due.getTime())) return false;

        return due.getTime() < Date.now();
    } catch {
        return false;
    }
};

// GET /api/strike/md-impex
// Returns active + removed strike records for mdimpex.
// Also auto-creates strike records for any currently overdue mdimpex tasks.
exports.getMdImpexStrike = async (req, res) => {
    try {
        const companyKey = 'mdimpex';

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);

        const actor = getActorFromRequest(req);
        const roleKey = normalizeText(actor?.role).toLowerCase();
        const managerScope = roleKey === 'manager' && actor?.id
            ? await (async () => {
                const managerDoc = await User.findById(actor.id).select('managerId email').lean().catch(() => null);
                const mdManagerId = managerDoc?.managerId ? String(managerDoc.managerId) : '';
                if (!mdManagerId || !mongoose.Types.ObjectId.isValid(mdManagerId)) {
                    return { mdManagerEmail: '', managerEmails: [] };
                }

                const mdManagerDoc = await User.findById(mdManagerId).select('email role').lean().catch(() => null);
                const mdManagerEmail = normalizeText(mdManagerDoc?.email).toLowerCase();
                const mdRole = normalizeText(mdManagerDoc?.role).toLowerCase();
                if (!mdManagerEmail || mdRole !== 'md_manager') {
                    return { mdManagerEmail: '', managerEmails: [] };
                }

                const peerManagers = await User.find({ role: 'manager', managerId: mdManagerId })
                    .select('email')
                    .lean()
                    .catch(() => []);
                const managerEmails = (peerManagers || [])
                    .map((u) => normalizeText(u?.email).toLowerCase())
                    .filter(Boolean);

                return { mdManagerEmail, managerEmails };
            })()
            : null;

        const scopeFilter = (() => {
            if (!actor?.email) return {};

            if (roleKey === 'md_manager') {
                return { assignedBy: actor.email };
            }

            if (roleKey === 'manager') {
                const mdManagerEmail = managerScope?.mdManagerEmail || '';
                const managerEmails = Array.isArray(managerScope?.managerEmails) ? managerScope.managerEmails : [];
                if (!mdManagerEmail || managerEmails.length === 0) return { _id: null };
                return {
                    assignedBy: mdManagerEmail,
                    assignedTo: { $in: managerEmails }
                };
            }

            return {};
        })();

        // "Ever overdue" definition:
        // - If task is NOT completed: dueDate < startOfToday (due date day has passed)
        // - If task is completed: it only counts as strike if it was completed AFTER due date day ended (statusUpdatedAt >= dueDate + 1 day)
        //   (this prevents tasks completed before due date from appearing later just because dueDate is in the past).
        const overdueTasks = await Task.find({
            isDeleted: { $ne: true },
            ...scopeFilter,
            $or: [
                { companyName: { $regex: /^md\s*impex$/i } },
                { company: { $regex: /^md\s*impex$/i } }
            ],
            $and: [{
                $or: [
                    {
                        status: { $ne: 'completed' },
                        dueDate: { $lt: todayStart }
                    },
                    {
                        status: 'completed',
                        statusUpdatedAt: { $ne: null },
                        $expr: { $gte: ['$statusUpdatedAt', { $add: ['$dueDate', 86400000] }] }
                    }
                ]
            }]
        }).select('_id dueDate').lean();

        const overdueTaskIds = (overdueTasks || [])
            .map((t) => t?._id)
            .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));

        // CRITICAL: Filter out existing strikes that should NOT be visible yet
        const strikes = await Strike.find({ companyKey })
            .sort({ isRemoved: 1, firstOverdueAt: -1 })
            .lean();

        const taskIds = (strikes || []).map((s) => s.taskId).filter(Boolean);
        const allRelevantTasks = taskIds.length
            ? await Task.find({ _id: { $in: taskIds }, isDeleted: { $ne: true }, ...scopeFilter }).lean()
            : [];

        const taskById = new Map((allRelevantTasks || []).map((t) => [String(t._id), t]));

        const data = (strikes || [])
            .map((s) => {
                const task = taskById.get(String(s.taskId));
                if (!task) return null;

                // Re-verify overdue logic for existing strike records
                // (This handles records created before logic change)
                const isCompleted = normalizeText(task.status).toLowerCase() === 'completed';
                if (!isCompleted) {
                    const due = new Date(task.dueDate);
                    if (due >= todayStart) return null; // Not yet overdue based on next-day logic
                } else {
                    if (task.statusUpdatedAt && task.dueDate) {
                        const dueTime = new Date(task.dueDate).getTime();
                        const completedTime = new Date(task.statusUpdatedAt).getTime();
                        if (completedTime <= dueTime + 86400000) return null; // Completed on time
                    }
                }

                return {
                    ...s,
                    id: s._id,
                    task
                };
            })
            .filter(Boolean);

        if (overdueTaskIds.length > 0) {
            const existingSet = new Set((strikes || []).map((s) => String(s.taskId)));
            const toInsert = overdueTasks
                .filter((t) => !existingSet.has(String(t._id)))
                .map((t) => ({
                    taskId: t._id,
                    companyKey,
                    firstOverdueAt: t?.dueDate ? new Date(t.dueDate) : new Date(),
                    isRemoved: false,
                    removalHistory: []
                }));

            if (toInsert.length > 0) {
                try {
                    await Strike.insertMany(toInsert, { ordered: false });
                } catch {
                    // ignore duplicate insert races
                }
            }
        }

        return res.json({ success: true, data });
    } catch (error) {
        console.error('getMdImpexStrike error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch strike data' });
    }
};

// PATCH /api/strike/:strikeId/remove
// md_manager only, requires remark
exports.removeStrike = async (req, res) => {
    try {
        const role = normalizeText(req.user?.role).toLowerCase();
        if (role !== 'md_manager') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const strikeId = normalizeText(req.params?.strikeId);
        if (!strikeId || !mongoose.Types.ObjectId.isValid(strikeId)) {
            return res.status(400).json({ success: false, message: 'Invalid strike id' });
        }

        const remark = normalizeText(req.body?.remark);
        if (!remark) {
            return res.status(400).json({ success: false, message: 'Remark is required' });
        }

        const actor = getActorFromRequest(req);

        const strike = await Strike.findById(strikeId);
        if (!strike) {
            return res.status(404).json({ success: false, message: 'Strike not found' });
        }

        if (strike.isRemoved) {
            return res.status(400).json({ success: false, message: 'Strike already removed' });
        }

        strike.isRemoved = true;
        strike.removalHistory.push({
            remark,
            removedAt: new Date(),
            removedBy: actor
        });

        await strike.save();

        return res.json({ success: true, message: 'Strike removed', data: { id: strike._id } });
    } catch (error) {
        console.error('removeStrike error:', error);
        return res.status(500).json({ success: false, message: 'Failed to remove strike' });
    }
};
