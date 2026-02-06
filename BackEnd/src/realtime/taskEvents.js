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

        if (companyKey) {
            io.to(`company:${companyKey}`).emit('task:upserted', payload);
        }

        const assigneeId = task && (task.assignedToUser && (task.assignedToUser.id || task.assignedToUser._id));
        if (assigneeId) {
            io.to(`user:${assigneeId}`).emit('task:upserted', payload);
        }

        io.to('role:admin-like').emit('task:upserted', payload);
    } catch (error) {
        console.error('emitTaskUpserted error:', error && error.message ? error.message : error);
    }
}

module.exports = {
    emitTaskUpserted,
};
