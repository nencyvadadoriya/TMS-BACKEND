const { getIO, normalizeCompanyKey } = require('./socket');

function emitUserUpserted(user) {
    try {
        const io = getIO();

        const companyName = (user && (user.companyName || user.company)) || '';
        const companyKey = normalizeCompanyKey(companyName);
        const userId = String(user && (user._id || user.id || ''));

        const payload = {
            type: 'user:upserted',
            userId,
            user,
        };

        if (companyKey) {
            io.to(`company:${companyKey}`).emit('user:upserted', payload);
        }

        if (userId) {
            io.to(`user:${userId}`).emit('user:upserted', payload);
        }

        io.to('role:admin-like').emit('user:upserted', payload);
    } catch (error) {
        console.error('emitUserUpserted error:', error && error.message ? error.message : error);
    }
}

function emitUserDeleted({ userId, companyName }) {
    try {
        const io = getIO();

        const companyKey = normalizeCompanyKey(companyName);

        const payload = {
            type: 'user:deleted',
            userId: String(userId || ''),
            companyName: String(companyName || ''),
        };

        if (companyKey) {
            io.to(`company:${companyKey}`).emit('user:deleted', payload);
        }

        if (userId) {
            io.to(`user:${userId}`).emit('user:deleted', payload);
        }

        io.to('role:admin-like').emit('user:deleted', payload);
    } catch (error) {
        console.error('emitUserDeleted error:', error && error.message ? error.message : error);
    }
}

module.exports = {
    emitUserUpserted,
    emitUserDeleted,
};
