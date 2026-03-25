const { getIO, normalizeCompanyKey } = require('./socket');

function emitTaskUpserted(task) {
    try {
        const io = getIO();

        const companyName = (task && (task.companyName || task.company)) || '';
        const companyKey = normalizeCompanyKey(companyName);

        const payload = {
            type: 'task:upserted',
            taskId: String(task && (task._id || task.id || '')),
            task,
        };

        console.log('[taskEvents] Emitting task:upserted', { 
            taskId: payload.taskId, 
            companyName, 
            companyKey 
        });

        const assigneeId = task && (task.assignedToUser && (task.assignedToUser.id || task.assignedToUser._id));
        if (assigneeId) {
            console.log(`[taskEvents] Targeting assignee room: user:${assigneeId}`);
            io.to(`user:${String(assigneeId)}`).emit('task:upserted', payload);
        }

        const assignerId = task && (task.assignedByUser && (task.assignedByUser.id || task.assignedByUser._id));
        if (assignerId) {
            console.log(`[taskEvents] Targeting assigner room: user:${assignerId}`);
            io.to(`user:${String(assignerId)}`).emit('task:upserted', payload);
        }

        // Also broadcast to everyone in the same company room
        if (companyKey) {
            console.log(`[taskEvents] Targeting company room: company:${companyKey}`);
            io.to(`company:${companyKey}`).emit('task:upserted', payload);
        }

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

        const assigneeId = task && (task.assignedToUser && (task.assignedToUser.id || task.assignedToUser._id));
        if (assigneeId) {
            io.to(`user:${assigneeId}`).emit('comment:added', payload);
        }

        const assignerId = task && (task.assignedByUser && (task.assignedByUser.id || task.assignedByUser._id));
        if (assignerId) {
            io.to(`user:${assignerId}`).emit('comment:added', payload);
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
