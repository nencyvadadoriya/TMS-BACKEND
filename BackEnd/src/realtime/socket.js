const { Server } = require('socket.io');

let io;

function normalizeCompanyKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
}

function initSocket(server) {
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            credentials: true,
        },
    });

    io.on('connection', (socket) => {
        const auth = socket.handshake.auth || {};

        const userId = (auth.userId || '').toString();
        const role = (auth.role || '').toString().trim().toLowerCase();
        const companyName = (auth.companyName || '').toString();

        const companyKey = normalizeCompanyKey(companyName);

        if (companyKey) {
            socket.join(`company:${companyKey}`);
        }

        if (userId) {
            socket.join(`user:${userId}`);
        }

        if (role === 'admin' || role === 'super_admin') {
            socket.join('role:admin-like');
        }
    });

    return io;
}

function getIO() {
    if (!io) {
        throw new Error('Socket.io has not been initialized');
    }
    return io;
}

module.exports = {
    initSocket,
    getIO,
    normalizeCompanyKey,
};
