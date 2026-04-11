const { getIO, normalizeCompanyKey } = require('./socket');

function emitTaskUpserted(task) {
    try {
        const io = getIO();

        const companyName = (task && (task.companyName || task.company)) || '';
        const companyKey = normalizeCompanyKey(companyName);

        const taskId = String(task && (task._id || task.id || ''));

        const payload = {
            type: 'task:upserted',
            taskId,
            task,
        };

        console.log('[taskEvents] Emitting task:upserted', {
            taskId,
            companyName,
            companyKey,
            assignedToUserId: task && task.assignedToUser && (task.assignedToUser.id || task.assignedToUser._id),
            assignedByUserId: task && task.assignedByUser && (task.assignedByUser.id || task.assignedByUser._id),
        });

        const emittedRooms = new Set();

        // ── Assignee room ─────────────────────────────────────────────────────────
        const assigneeId = task && task.assignedToUser && (task.assignedToUser.id || task.assignedToUser._id);
        if (assigneeId) {
            const room = `user:${String(assigneeId)}`;
            console.log(`[taskEvents] → assignee room: ${room}`);
            io.to(room).emit('task:upserted', payload);
            emittedRooms.add(room);
        } else {
            console.warn('[taskEvents] ⚠️  assignedToUser.id missing — skipping user room for assignee. Covered by company room.');
        }

        // ── Assigner room ─────────────────────────────────────────────────────────
        const assignerId = task && task.assignedByUser && (task.assignedByUser.id || task.assignedByUser._id);
        if (assignerId) {
            const room = `user:${String(assignerId)}`;
            if (!emittedRooms.has(room)) {
                console.log(`[taskEvents] → assigner room: ${room}`);
                io.to(room).emit('task:upserted', payload);
                emittedRooms.add(room);
            }
        }

        // ── Company room — catches all members when user rooms aren't targeted ───
        if (companyKey) {
            const room = `company:${companyKey}`;
            console.log(`[taskEvents] → company room: ${room}`);
            io.to(room).emit('task:upserted', payload);
        } else {
            console.warn('[taskEvents] ⚠️  companyKey is empty — company room NOT targeted. This task may not reach all users!');
        }

        // ── Admin room ────────────────────────────────────────────────────────────
        io.to('role:admin-like').emit('task:upserted', payload);

    } catch (error) {
        console.error('emitTaskUpserted error:', error && error.message ? error.message : error);
    }
}

function emitCommentAdded({ task, comment }) {
    try {
        const io = getIO();

        const companyName = (task && (task.companyName || task.company)) || '';
        const companyKey = normalizeCompanyKey(companyName);

        const payload = {
            type: 'comment:added',
            taskId: String(task && (task._id || task.id || '')),
            comment,
        };

        const emittedRooms = new Set();

        const assigneeId = task && task.assignedToUser && (task.assignedToUser.id || task.assignedToUser._id);
        if (assigneeId) {
            const room = `user:${assigneeId}`;
            io.to(room).emit('comment:added', payload);
            emittedRooms.add(room);
        }

        const assignerId = task && task.assignedByUser && (task.assignedByUser.id || task.assignedByUser._id);
        if (assignerId) {
            const room = `user:${assignerId}`;
            if (!emittedRooms.has(room)) {
                io.to(room).emit('comment:added', payload);
                emittedRooms.add(room);
            }
        }

        if (companyKey) {
            io.to(`company:${companyKey}`).emit('comment:added', payload);
        }

        io.to('role:admin-like').emit('comment:added', payload);
    } catch (error) {
        console.error('emitCommentAdded error:', error && error.message ? error.message : error);
    }
}

module.exports = {
    emitTaskUpserted,
    emitCommentAdded,
};
