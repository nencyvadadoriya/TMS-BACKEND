// Optimized Task Controller with performance improvements
const mongoose = require('mongoose');
const Task = require('../model/Task.model');
const Brand = require('../model/Brand.model');
const User = require('../model/User.model');
const Comment = require('../model/Comment.model');
const TaskHistory = require('../model/TaskHistory.model');
const { createTaskCalendarInvite, refreshAccessToken, updateGoogleTask, deleteGoogleTask } = require('../utils/googleCalendar.util');
const { sendTaskAssignedEmail } = require('../middleware/email.message');
const { getPaginationParams, formatPaginatedResponse } = require('../utils/pagination.util');

const { sendTaskAssignedPush } = require('../utils/pushNotifications.util');
const { emitTaskUpserted } = require('../realtime/taskEvents');

// Utility functions
const normalizeText = (value) => (value == null ? '' : String(value)).trim();
const normalizeEmail = (email) => {
    const raw = normalizeText(email);
    if (!raw) return '';
    const marker = '.deleted.';
    const idx = raw.indexOf(marker);
    return idx >= 0 ? raw.substring(0, idx) : raw.toLowerCase();
};

const roleOf = (user) => {
    if (!user) return '';
    return String(user.role || '').trim().toLowerCase();
};

const safeObjectIdString = (v) => {
    if (!v) return '';
    const s = String(v).trim();
    return mongoose.Types.ObjectId.isValid(s) ? s : '';
};

// Optimized getAllTasks with aggregation pipeline
const getAllTasksOptimized = async (req, res) => {
    try {
        const requesterRole = roleOf(req.user);
        const requesterEmail = normalizeEmail(req.user?.email);
        const { page, limit, skip } = getPaginationParams(req.query);
        const sortOrder = req.query.sort === 'asc' ? 1 : -1;

        console.log('getAllTasks called by:', { requesterRole, requesterEmail, page, limit, sort: req.query.sort });

        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

        // Base match conditions
        const baseMatch = {
            isDeleted: { $ne: true },
            completedApproval: { $ne: true },
            createdAt: { $gte: twoMonthsAgo }
        };

        // Pre-compute user scope for performance
        let allowedEmails = new Set();

        if (requesterRole === 'admin' || requesterRole === 'super_admin') {
            // No additional filters for admins - they see all
        } else {
            // Single optimized query to get all relevant users based on role
            let userQuery = {};

            if (requesterRole === 'ob_manager') {
                const requesterId = safeObjectIdString(req.user?.id || req.user?._id || req.user?.userId);
                let requesterCompany = (req.user?.companyName || '').toString().trim();

                if (!requesterCompany && requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
                    const doc = await User.findById(requesterId).select('companyName').lean();
                    requesterCompany = (doc?.companyName || '').toString().trim();
                }

                const teamRoleRegex = /^(assistant|assistance|assistence|sub[_-]?assistance|sub[_-]?assistence|sub[_-]?assist|sub[_-]?assistant|manager)$/i;

                userQuery = {
                    $or: [
                        {
                            companyName: requesterCompany ? new RegExp(`^${requesterCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') : { $exists: true },
                            role: { $regex: teamRoleRegex }
                        },
                        { email: requesterEmail }
                    ]
                };
            } else if (requesterRole === 'manager' || requesterRole === 'md_manager') {
                const requesterId = safeObjectIdString(req.user?.id || req.user?._id || req.user?.userId);
                let requesterCompany = (req.user?.companyName || '').toString().trim();

                if (!requesterCompany && requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
                    const doc = await User.findById(requesterId).select('companyName').lean();
                    requesterCompany = (doc?.companyName || '').toString().trim();
                }

                const teamRoleRegex = /^(md_manager|manager|assistant|assistance|assistence|sub[_-]?assistance|sub[_-]?assistence|sub[_-]?assist|sub[_-]?assistant)$/i;
                const obManagerRoleRegex = /^ob_manager$/i;

                userQuery = {
                    $or: [
                        {
                            companyName: requesterCompany ? new RegExp(`^${requesterCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') : { $exists: true },
                            $or: [
                                { role: { $regex: teamRoleRegex } },
                                { role: { $regex: obManagerRoleRegex } }
                            ]
                        },
                        { email: requesterEmail }
                    ]
                };
            } else {
                // For other roles, just include the requester
                userQuery = { email: requesterEmail };
            }

            // Get all relevant users in one query
            const relevantUsers = await User.find(userQuery).select('email').lean();
            relevantUsers.forEach(user => {
                if (user.email) allowedEmails.add(normalizeEmail(user.email));
            });

            // Add scope emails for certain roles
            if (['am', 'sbm', 'rm', 'ar'].includes(requesterRole)) {
                try {
                    const scopeEmails = requesterRole === 'am'
                        ? [requesterEmail, await resolveRmEmailForAmUser(req.user)].filter(Boolean)
                        : Array.from(await resolveTaskScopeEmails(req.user));

                    scopeEmails.forEach(email => allowedEmails.add(normalizeEmail(email)));
                } catch (error) {
                    console.warn('Error resolving scope emails:', error);
                }
            }

            allowedEmails.add(requesterEmail); // Always include requester
        }

        // Convert Set to Array for MongoDB query
        const allowedEmailsArray = Array.from(allowedEmails);

        if (allowedEmailsArray.length === 0 && requesterRole !== 'admin' && requesterRole !== 'super_admin') {
            return res.json(formatPaginatedResponse([], 0, { page, limit }));
        }

        // Build final match query
        const finalMatch = { ...baseMatch };
        if (requesterRole !== 'admin' && requesterRole !== 'super_admin') {
            finalMatch.$or = [
                { assignedTo: { $in: allowedEmailsArray } },
                { assignedBy: { $in: allowedEmailsArray } }
            ];
        }

        // Use aggregation pipeline for better performance with joins
        const aggregationPipeline = [
            { $match: finalMatch },
            {
                $lookup: {
                    from: 'users',
                    localField: 'assignedTo',
                    foreignField: 'email',
                    as: 'assignedToUser'
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'assignedBy',
                    foreignField: 'email',
                    as: 'assignedByUser'
                }
            },
            {
                $lookup: {
                    from: 'brands',
                    localField: 'brandId',
                    foreignField: '_id',
                    as: 'brandDetails'
                }
            },
            {
                $unwind: {
                    path: '$assignedToUser',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $unwind: {
                    path: '$assignedByUser',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $unwind: {
                    path: '$brandDetails',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 1,
                    id: '$_id',
                    title: 1,
                    description: 1,
                    status: 1,
                    priority: 1,
                    dueDate: 1,
                    assignedTo: 1,
                    assignedBy: 1,
                    brand: { $ifNull: ['$brandDetails.name', '$brand'] },
                    brandId: 1,
                    taskType: 1,
                    companyName: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    assignedToUser: {
                        id: '$assignedToUser._id',
                        name: '$assignedToUser.name',
                        email: '$assignedToUser.email',
                        avatar: '$assignedToUser.avatar',
                        role: '$assignedToUser.role'
                    },
                    assignedByUser: {
                        id: '$assignedByUser._id',
                        name: '$assignedByUser.name',
                        email: '$assignedByUser.email',
                        avatar: '$assignedByUser.avatar',
                        role: '$assignedByUser.role'
                    },
                    brandDetails: {
                        id: '$brandDetails._id',
                        name: '$brandDetails.name',
                        groupNumber: '$brandDetails.groupNumber',
                        company: '$brandDetails.company'
                    }
                }
            },
            { $sort: { createdAt: sortOrder } },
            { $skip: skip },
            { $limit: limit }
        ];

        // Get total count and paginated results in parallel
        const [totalCountResult, tasks] = await Promise.all([
            Task.countDocuments(finalMatch),
            Task.aggregate(aggregationPipeline)
        ]);

        const totalCount = totalCountResult || 0;

        console.log(`getAllTasks [${requesterRole}]: total=${totalCount}, page=${page}, returned=${tasks.length}`);

        return res.json({
            success: true,
            data: tasks,
            pagination: {
                total: totalCount,
                page,
                limit,
                pages: Math.ceil(totalCount / limit)
            },
            message: 'Tasks fetched successfully'
        });

    } catch (error) {
        console.error('Error fetching tasks:', error);
        return res.status(500).json({ success: false, message: 'Error fetching tasks', error: error.message });
    }
};

// Helper functions (simplified versions)
const resolveRmEmailForAmUser = async (user) => {
    // Simplified implementation - you may need to expand this based on your business logic
    return null;
};

const resolveTaskScopeEmails = async (user) => {
    // Simplified implementation - you may need to expand this based on your business logic
    return new Set([normalizeEmail(user?.email)]);
};

module.exports = {
    getAllTasksOptimized,
    // Export other functions as needed
};