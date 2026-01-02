const Task = require('../model/Task.model');
const User = require('../model/user.model');

const { refreshAccessToken, getGoogleTask, updateGoogleTask, listGoogleTasks, listGoogleTaskLists } = require('./googleCalendar.util');

const normalizeEmail = (email) => (email || '').toString().trim().toLowerCase();

const toGoogleStatus = (dbStatus) => (String(dbStatus || '').toLowerCase() === 'completed' ? 'completed' : 'needsAction');

const toDbStatus = (googleStatus) => (String(googleStatus || '').toLowerCase() === 'completed' ? 'completed' : 'pending');

const parseGoogleUpdatedAt = (googleTask) => {
    const raw = googleTask?.updated;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
};

const isGoogleNotFoundError = (error) => {
    const statusCode = error?.statusCode;
    const responseBody = error?.responseBody;
    const apiStatus = responseBody?.error?.status;
    const apiCode = responseBody?.error?.code;
    return statusCode === 404 || apiStatus === 'NOT_FOUND' || apiCode === 404;
};

const getAccessTokenForRefreshToken = async (refreshToken) => {
    const tokenResponse = await refreshAccessToken(refreshToken);
    const accessToken = tokenResponse?.access_token;
    if (!accessToken) {
        const err = new Error('Failed to refresh access token');
        err.responseBody = tokenResponse;
        throw err;
    }
    return accessToken;
};

const parseGoogleDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

const parseGoogleTaskNotesFields = (notes) => {
    const text = (notes || '').toString();
    if (!text.trim()) return {};

    const fields = {};
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (!value) continue;
        fields[key] = value;
    }

    const companyName = fields.company || fields['company name'] || null;
    const brand = fields.brand || null;
    const assignedTo = fields['assigned to'] || fields.assignee || null;
    const assignedBy = fields['assigned by'] || fields.assigner || null;

    return {
        companyName: companyName ? companyName.toString() : null,
        brand: brand ? brand.toString() : null,
        assignedTo: assignedTo ? normalizeEmail(assignedTo) : null,
        assignedBy: assignedBy ? normalizeEmail(assignedBy) : null
    };
};

const dedupeImportedGoogleTaskDocs = async ({ ownerEmail, googleTaskId }) => {
    const email = normalizeEmail(ownerEmail);
    const taskId = (googleTaskId || '').toString().trim();
    if (!taskId) return;

    const docs = await Task.find({
        'googleSync.taskId': taskId
    })
        .select('_id googleSync.googleUpdatedAt googleSync.ownerEmail updatedAt createdAt')
        .lean();

    if (!Array.isArray(docs) || docs.length <= 1) return;

    const toTime = (d) => {
        const raw = d?.googleSync?.googleUpdatedAt || d?.updatedAt || d?.createdAt;
        const dt = raw ? new Date(raw) : null;
        return dt && !Number.isNaN(dt.getTime()) ? dt.getTime() : 0;
    };

    docs.sort((a, b) => toTime(b) - toTime(a));
    const keepId = docs[0]._id;
    const deleteIds = docs.slice(1).map((d) => d._id).filter((id) => String(id) !== String(keepId));
    if (!deleteIds.length) return;

    await Task.deleteMany({ _id: { $in: deleteIds } });

    if (email) {
        await Task.findByIdAndUpdate(keepId, {
            $set: {
                'googleSync.ownerEmail': email
            }
        });
    }
};

const buildImportedTaskDoc = ({ googleTask, ownerEmail, tasklistId = '@default' }) => {
    const title = (googleTask?.title || '').toString().trim() || 'Untitled';
    const due = parseGoogleDate(googleTask?.due) || parseGoogleDate(googleTask?.updated) || new Date();
    const status = toDbStatus(googleTask?.status);

    const parsedFields = parseGoogleTaskNotesFields(googleTask?.notes);
    const assignedTo = parsedFields.assignedTo || ownerEmail;
    const assignedBy = parsedFields.assignedBy || ownerEmail;

    const statusUpdatedAt =
        (status === 'completed' ? (parseGoogleDate(googleTask?.completed) || parseGoogleDate(googleTask?.updated)) : parseGoogleDate(googleTask?.updated))
        || new Date();

    const googleUpdatedAt = parseGoogleDate(googleTask?.updated) || new Date();

    return {
        title,
        taskType: 'google',
        companyName: parsedFields.companyName || '',
        brand: parsedFields.brand || '',
        brandId: null,
        status,
        statusUpdatedAt,
        completedApproval: false,
        priority: 'medium',
        dueDate: due,
        assignedTo,
        assignedBy,
        googleSync: {
            taskId: googleTask?.id || null,
            tasklistId,
            ownerEmail,
            syncedAt: new Date(),
            googleUpdatedAt,
            lastError: null
        }
    };
};

const syncTaskStatusBidirectional = async ({ task, accessToken }) => {
    const tasklistId = task?.googleSync?.tasklistId || '@default';
    const googleTaskId = task?.googleSync?.taskId;

    if (!googleTaskId) {
        return { skipped: true, reason: 'missing_google_task_id' };
    }

    let googleTask;
    try {
        googleTask = await getGoogleTask({ accessToken, tasklistId, taskId: googleTaskId });
    } catch (error) {
        if (isGoogleNotFoundError(error)) {
            await Task.findByIdAndUpdate(task._id, {
                $set: {
                    'googleSync.taskId': null,
                    'googleSync.tasklistId': '@default',
                    'googleSync.googleUpdatedAt': null,
                    'googleSync.lastError': 'Google task not found (deleted or wrong account). Please resync.',
                    'googleSync.syncedAt': new Date()
                }
            });
            return { direction: 'noop', updated: false, removed: true };
        }
        throw error;
    }

    const googleUpdatedAt = parseGoogleUpdatedAt(googleTask);
    const dbStatusUpdatedAt = task?.statusUpdatedAt ? new Date(task.statusUpdatedAt) : null;
    const dbUpdatedValid = dbStatusUpdatedAt && !Number.isNaN(dbStatusUpdatedAt.getTime());

    const googleStatus = toDbStatus(googleTask?.status);
    const dbStatus = String(task?.status || '').toLowerCase();

    const dbChangedAt = dbUpdatedValid ? dbStatusUpdatedAt : new Date(task.updatedAt || task.createdAt || Date.now());
    const googleChangedAt = googleUpdatedAt || new Date(task.googleSync?.googleUpdatedAt || 0);

    if (googleChangedAt && dbChangedAt && googleChangedAt.getTime() > dbChangedAt.getTime()) {
        if (googleStatus !== dbStatus) {
            await Task.findByIdAndUpdate(task._id, {
                status: googleStatus,
                statusUpdatedAt: googleChangedAt,
                'googleSync.googleUpdatedAt': googleChangedAt,
                'googleSync.syncedAt': new Date(),
                'googleSync.lastError': null
            });
            return { direction: 'google_to_db', updated: true };
        }

        await Task.findByIdAndUpdate(task._id, {
            'googleSync.googleUpdatedAt': googleChangedAt,
            'googleSync.syncedAt': new Date(),
            'googleSync.lastError': null
        });
        return { direction: 'google_to_db', updated: false };
    }

    if (dbChangedAt && googleChangedAt && dbChangedAt.getTime() > googleChangedAt.getTime()) {
        const desiredGoogleStatus = toGoogleStatus(dbStatus);
        if (String(googleTask?.status || '').toLowerCase() !== desiredGoogleStatus.toLowerCase()) {
            const patch = { status: desiredGoogleStatus };
            if (desiredGoogleStatus === 'completed') {
                patch.completed = dbChangedAt.toISOString();
            }

            let updatedGoogle;
            try {
                updatedGoogle = await updateGoogleTask({ accessToken, tasklistId, taskId: googleTaskId, patch });
            } catch (error) {
                if (isGoogleNotFoundError(error)) {
                    await Task.findByIdAndUpdate(task._id, {
                        $set: {
                            'googleSync.taskId': null,
                            'googleSync.tasklistId': '@default',
                            'googleSync.googleUpdatedAt': null,
                            'googleSync.lastError': 'Google task not found (deleted or wrong account). Please resync.',
                            'googleSync.syncedAt': new Date()
                        }
                    });
                    return { direction: 'noop', updated: false, removed: true };
                }
                throw error;
            }
            const nextGoogleUpdatedAt = parseGoogleUpdatedAt(updatedGoogle) || new Date();

            await Task.findByIdAndUpdate(task._id, {
                'googleSync.googleUpdatedAt': nextGoogleUpdatedAt,
                'googleSync.syncedAt': new Date(),
                'googleSync.lastError': null
            });

            return { direction: 'db_to_google', updated: true };
        }

        await Task.findByIdAndUpdate(task._id, {
            'googleSync.syncedAt': new Date(),
            'googleSync.lastError': null                  
        });
        return { direction: 'db_to_google', updated: false };
    }

    await Task.findByIdAndUpdate(task._id, {
        'googleSync.syncedAt': new Date(),
        'googleSync.lastError': null
    });
    return { direction: 'noop', updated: false };
};

const runGoogleTasksStatusSyncOnce = async () => {
    const tasks = await Task.find({ 'googleSync.taskId': { $ne: null } }).lean();
    if (!tasks.length) return { scanned: 0, synced: 0 };

    const tasksByOwner = new Map();
    for (const task of tasks) {
        const ownerEmail = normalizeEmail(task?.googleSync?.ownerEmail);
        if (!ownerEmail) continue;
        const bucket = tasksByOwner.get(ownerEmail) || [];
        bucket.push(task);
        tasksByOwner.set(ownerEmail, bucket);
    }

    const owners = Array.from(tasksByOwner.keys());
    const users = await User.find({ email: { $in: owners } })
        .select('email isGoogleCalendarConnected googleOAuth.refreshToken googleOAuth.scope')
        .lean();

    const userByEmail = new Map(users.map((u) => [normalizeEmail(u.email), u]));

    let synced = 0;

    for (const [ownerEmail, ownerTasks] of tasksByOwner.entries()) {
        const user = userByEmail.get(ownerEmail);
        const refreshToken = user?.isGoogleCalendarConnected ? user?.googleOAuth?.refreshToken : null;
        const scopes = Array.isArray(user?.googleOAuth?.scope) ? user.googleOAuth.scope : [];

        if (!refreshToken || !scopes.includes('https://www.googleapis.com/auth/tasks')) {
            continue;
        }

        let accessToken;
        try {
            accessToken = await getAccessTokenForRefreshToken(refreshToken);
        } catch (error) {
            const msg = error?.message || 'Failed to refresh access token';
            await Task.updateMany(
                { _id: { $in: ownerTasks.map((t) => t._id) } },
                { $set: { 'googleSync.lastError': msg } }
            );
            continue;
        }

        for (const task of ownerTasks) {
            try {
                await syncTaskStatusBidirectional({ task, accessToken });
                synced += 1;
            } catch (error) {
                const msg = error?.message || 'Google sync failed';
                await Task.findByIdAndUpdate(task._id, {
                    'googleSync.lastError': msg,
                    'googleSync.syncedAt': new Date()
                });
            }
        }
    }

    return { scanned: tasks.length, synced };
};

const startGoogleTasksStatusSync = ({ intervalMinutes = 5 } = {}) => {
    const minutes = Number(intervalMinutes);
    const intervalMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 5) * 60 * 1000;

    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await runGoogleTasksStatusSyncOnce();
        } finally {
            running = false;
        }
    };

    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
};

const runGoogleTasksImportForUserId = async ({ userId }) => {
    if (!userId) {
        throw new Error('Missing userId');
    }

    const user = await User.findById(userId)
        .select('email isGoogleCalendarConnected googleOAuth.refreshToken googleOAuth.scope googleOAuth.tasksLastPulledAt')
        .lean();

    if (!user) {
        throw new Error('User not found');
    }

    const ownerEmail = normalizeEmail(user?.email);
    const refreshToken = user?.isGoogleCalendarConnected ? user?.googleOAuth?.refreshToken : null;
    const scopes = Array.isArray(user?.googleOAuth?.scope) ? user.googleOAuth.scope : [];

    if (!ownerEmail || !refreshToken || !scopes.includes('https://www.googleapis.com/auth/tasks')) {
        return { users: 1, imported: 0, updated: 0, skippedDeleted: 0, failedUsers: 1 };
    }

    const accessToken = await getAccessTokenForRefreshToken(refreshToken);

    let imported = 0;
    let updated = 0;
    let skippedDeleted = 0;

    const lastPulledAt = user?.googleOAuth?.tasksLastPulledAt ? new Date(user.googleOAuth.tasksLastPulledAt) : null;
    const lastPulledValid = lastPulledAt && !Number.isNaN(lastPulledAt.getTime());
    const updatedMin = lastPulledValid
        ? lastPulledAt.toISOString()
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    let listsPageToken;
    const tasklistIds = [];
    do {
        const listsPage = await listGoogleTaskLists({ accessToken, pageToken: listsPageToken, maxResults: 100 });
        const lists = Array.isArray(listsPage?.items) ? listsPage.items : [];
        for (const l of lists) {
            if (l?.id) tasklistIds.push(String(l.id));
        }
        listsPageToken = listsPage?.nextPageToken || null;
    } while (listsPageToken);

    if (!tasklistIds.length) {
        tasklistIds.push('@default');
    }

    for (const tasklistId of tasklistIds) {
        let pageToken;
        do {
            const page = await listGoogleTasks({
                accessToken,
                tasklistId,
                pageToken,
                updatedMin,
                showCompleted: true,
                showDeleted: true,
                showHidden: true,
                maxResults: 100
            });

            const items = Array.isArray(page?.items) ? page.items : [];
            for (const googleTask of items) {
                if (googleTask?.deleted) {
                    skippedDeleted += 1;
                    continue;
                }

                const googleTaskId = googleTask?.id;
                if (!googleTaskId) continue;

                const googleUpdatedAt = parseGoogleDate(googleTask?.updated) || new Date();

                let existing = await Task.findOne({
                    'googleSync.taskId': googleTaskId,
                    'googleSync.ownerEmail': ownerEmail
                }).select('_id googleSync.googleUpdatedAt googleSync.ownerEmail');

                if (!existing) {
                    existing = await Task.findOne({
                        'googleSync.taskId': googleTaskId
                    }).select('_id googleSync.googleUpdatedAt googleSync.ownerEmail');
                }

                if (!existing) {
                    const doc = buildImportedTaskDoc({ googleTask, ownerEmail, tasklistId });
                    await Task.create(doc);
                    imported += 1;
                    await dedupeImportedGoogleTaskDocs({ ownerEmail, googleTaskId });
                    continue;
                }

                const existingUpdatedAt = existing?.googleSync?.googleUpdatedAt ? new Date(existing.googleSync.googleUpdatedAt) : null;
                const existingUpdatedValid = existingUpdatedAt && !Number.isNaN(existingUpdatedAt.getTime());
                if (existingUpdatedValid && existingUpdatedAt.getTime() >= googleUpdatedAt.getTime()) {
                    continue;
                }

                const status = toDbStatus(googleTask?.status);
                const statusUpdatedAt =
                    (status === 'completed' ? (parseGoogleDate(googleTask?.completed) || googleUpdatedAt) : googleUpdatedAt)
                    || new Date();

                const dueDate = parseGoogleDate(googleTask?.due) || googleUpdatedAt || new Date();

                const parsedFields = parseGoogleTaskNotesFields(googleTask?.notes);
                const ownerEmailFromDb = normalizeEmail(existing?.googleSync?.ownerEmail);
                const nextOwnerEmail = ownerEmailFromDb || ownerEmail;

                const setPatch = {
                    title: (googleTask?.title || '').toString().trim() || 'Untitled',
                    status,
                    statusUpdatedAt,
                    dueDate,
                    'googleSync.tasklistId': tasklistId,
                    'googleSync.ownerEmail': nextOwnerEmail,
                    'googleSync.googleUpdatedAt': googleUpdatedAt,
                    'googleSync.syncedAt': new Date(),
                    'googleSync.lastError': null
                };

                if (parsedFields.companyName) setPatch.companyName = parsedFields.companyName;
                if (parsedFields.brand) setPatch.brand = parsedFields.brand;
                if (parsedFields.assignedTo) setPatch.assignedTo = parsedFields.assignedTo;
                if (parsedFields.assignedBy) setPatch.assignedBy = parsedFields.assignedBy;

                await Task.findByIdAndUpdate(existing._id, { $set: setPatch });
                updated += 1;
                await dedupeImportedGoogleTaskDocs({ ownerEmail: nextOwnerEmail, googleTaskId });
            }

            pageToken = page?.nextPageToken || null;
        } while (pageToken);
    }

    await User.findByIdAndUpdate(userId, {
        $set: { 'googleOAuth.tasksLastPulledAt': new Date() }
    });

    return { users: 1, imported, updated, skippedDeleted, failedUsers: 0 };
};

const runGoogleTasksImportOnce = async () => {
    const users = await User.find({ isGoogleCalendarConnected: true })
        .select('email isGoogleCalendarConnected googleOAuth.refreshToken googleOAuth.scope googleOAuth.tasksLastPulledAt')
        .lean();

    const eligibleUsers = (users || []).filter((u) => {
        const refreshToken = u?.googleOAuth?.refreshToken;
        const scopes = Array.isArray(u?.googleOAuth?.scope) ? u.googleOAuth.scope : [];
        return Boolean(refreshToken) && scopes.includes('https://www.googleapis.com/auth/tasks');
    });

    if (!eligibleUsers.length) {
        return { users: 0, imported: 0, updated: 0, skippedDeleted: 0, failedUsers: 0 };
    }

    let imported = 0;
    let updated = 0;
    let skippedDeleted = 0;
    let failedUsers = 0;

    for (const user of eligibleUsers) {
        const ownerEmail = normalizeEmail(user?.email);
        const refreshToken = user?.googleOAuth?.refreshToken;
        if (!ownerEmail || !refreshToken) continue;

        let accessToken;
        try {
            accessToken = await getAccessTokenForRefreshToken(refreshToken);
        } catch {
            failedUsers += 1;
            continue;
        }

        const lastPulledAt = user?.googleOAuth?.tasksLastPulledAt ? new Date(user.googleOAuth.tasksLastPulledAt) : null;
        const lastPulledValid = lastPulledAt && !Number.isNaN(lastPulledAt.getTime());
        const updatedMin = lastPulledValid
            ? lastPulledAt.toISOString()
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        let listsPageToken;
        const tasklistIds = [];
        do {
            const listsPage = await listGoogleTaskLists({ accessToken, pageToken: listsPageToken, maxResults: 100 });
            const lists = Array.isArray(listsPage?.items) ? listsPage.items : [];
            for (const l of lists) {
                if (l?.id) tasklistIds.push(String(l.id));
            }
            listsPageToken = listsPage?.nextPageToken || null;
        } while (listsPageToken);

        if (!tasklistIds.length) {
            tasklistIds.push('@default');
        }

        for (const tasklistId of tasklistIds) {
            let pageToken;
            do {
                const page = await listGoogleTasks({
                    accessToken,
                    tasklistId,
                    pageToken,
                    updatedMin,
                    showCompleted: true,
                    showDeleted: true,
                    showHidden: true,
                    maxResults: 100
                });

                const items = Array.isArray(page?.items) ? page.items : [];
                for (const googleTask of items) {
                    if (googleTask?.deleted) {
                        skippedDeleted += 1;
                        continue;
                    }

                    const googleTaskId = googleTask?.id;
                    if (!googleTaskId) continue;

                    const googleUpdatedAt = parseGoogleDate(googleTask?.updated) || new Date();

                    let existing = await Task.findOne({
                        'googleSync.taskId': googleTaskId,
                        'googleSync.ownerEmail': ownerEmail
                    }).select('_id googleSync.googleUpdatedAt googleSync.ownerEmail');

                    if (!existing) {
                        existing = await Task.findOne({
                            'googleSync.taskId': googleTaskId
                        }).select('_id googleSync.googleUpdatedAt googleSync.ownerEmail');
                    }

                    if (!existing) {
                        const doc = buildImportedTaskDoc({ googleTask, ownerEmail, tasklistId });
                        await Task.create(doc);
                        imported += 1;
                        await dedupeImportedGoogleTaskDocs({ ownerEmail, googleTaskId });
                        continue;
                    }

                    const existingUpdatedAt = existing?.googleSync?.googleUpdatedAt ? new Date(existing.googleSync.googleUpdatedAt) : null;
                    const existingUpdatedValid = existingUpdatedAt && !Number.isNaN(existingUpdatedAt.getTime());
                    if (existingUpdatedValid && existingUpdatedAt.getTime() >= googleUpdatedAt.getTime()) {
                        continue;
                    }

                    const status = toDbStatus(googleTask?.status);
                    const statusUpdatedAt =
                        (status === 'completed' ? (parseGoogleDate(googleTask?.completed) || googleUpdatedAt) : googleUpdatedAt)
                        || new Date();

                    const dueDate = parseGoogleDate(googleTask?.due) || googleUpdatedAt || new Date();

                    const parsedFields = parseGoogleTaskNotesFields(googleTask?.notes);
                    const ownerEmailFromDb = normalizeEmail(existing?.googleSync?.ownerEmail);
                    const nextOwnerEmail = ownerEmailFromDb || ownerEmail;

                    const setPatch = {
                        title: (googleTask?.title || '').toString().trim() || 'Untitled',
                        status,
                        statusUpdatedAt,
                        dueDate,
                        'googleSync.tasklistId': tasklistId,
                        'googleSync.ownerEmail': nextOwnerEmail,
                        'googleSync.googleUpdatedAt': googleUpdatedAt,
                        'googleSync.syncedAt': new Date(),
                        'googleSync.lastError': null
                    };

                    if (parsedFields.companyName) setPatch.companyName = parsedFields.companyName;
                    if (parsedFields.brand) setPatch.brand = parsedFields.brand;
                    if (parsedFields.assignedTo) setPatch.assignedTo = parsedFields.assignedTo;
                    if (parsedFields.assignedBy) setPatch.assignedBy = parsedFields.assignedBy;

                    await Task.findByIdAndUpdate(existing._id, { $set: setPatch });
                    updated += 1;
                    await dedupeImportedGoogleTaskDocs({ ownerEmail: nextOwnerEmail, googleTaskId });
                }

                pageToken = page?.nextPageToken || null;
            } while (pageToken);
        }

        await User.findOneAndUpdate(
            { email: ownerEmail },
            { $set: { 'googleOAuth.tasksLastPulledAt': new Date() } }
        );
    }

    return { users: eligibleUsers.length, imported, updated, skippedDeleted, failedUsers };
};

const startGoogleTasksImportSync = ({ intervalMinutes = 5 } = {}) => {
    const minutes = Number(intervalMinutes);
    const intervalMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 5) * 60 * 1000;

    let running = false;

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const result = await runGoogleTasksImportOnce();
            console.log('[GoogleTasksImport]', result);
        } finally {
            running = false;
        }
    };

    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
};

module.exports = {
    startGoogleTasksStatusSync,
    runGoogleTasksStatusSyncOnce,
    startGoogleTasksImportSync,
    runGoogleTasksImportOnce,
    runGoogleTasksImportForUserId
};
