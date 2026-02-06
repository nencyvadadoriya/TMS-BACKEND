const { getIO, normalizeCompanyKey } = require('./socket');

function emitAssignmentUpserted({ companyName, userId, brandId }) {
    try {
        const io = getIO();

        const companyKey = normalizeCompanyKey(companyName);

        const payload = {
            type: 'assignment:upserted',
            companyName: String(companyName || ''),
            userId: String(userId || ''),
            brandId: String(brandId || ''),
        };

        if (companyKey) {
            io.to(`company:${companyKey}`).emit('assignment:upserted', payload);
        }

        if (payload.userId) {
            io.to(`user:${payload.userId}`).emit('assignment:upserted', payload);
        }

        io.to('role:admin-like').emit('assignment:upserted', payload);
    } catch (error) {
        console.error('emitAssignmentUpserted error:', error && error.message ? error.message : error);
    }
}

function emitAssignmentsBulkUpserted({ companyName, userId }) {
    try {
        const io = getIO();

        const companyKey = normalizeCompanyKey(companyName);

        const payload = {
            type: 'assignment:bulk-upserted',
            companyName: String(companyName || ''),
            userId: String(userId || ''),
        };

        if (companyKey) {
            io.to(`company:${companyKey}`).emit('assignment:bulk-upserted', payload);
        }

        if (payload.userId) {
            io.to(`user:${payload.userId}`).emit('assignment:bulk-upserted', payload);
        }

        io.to('role:admin-like').emit('assignment:bulk-upserted', payload);
    } catch (error) {
        console.error('emitAssignmentsBulkUpserted error:', error && error.message ? error.message : error);
    }
}

module.exports = {
    emitAssignmentUpserted,
    emitAssignmentsBulkUpserted,
};
