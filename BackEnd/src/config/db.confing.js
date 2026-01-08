const mongoose = require('mongoose');

const mongoUrl = process.env.MONGODB_URI;

const db = mongoose.connection;

const connectOptions = {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 0),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000)
};

let retryDelayMs = Number(process.env.MONGO_RETRY_DELAY_MS || 2000);
const maxRetryDelayMs = Number(process.env.MONGO_MAX_RETRY_DELAY_MS || 30000);
let connecting = false;

const connectWithRetry = async () => {
    if (connecting) return;
    if (!mongoUrl) {
        console.error('DB connection skipped: MONGODB_URI is not set');
        return;
    }

    connecting = true;
    try {
        await mongoose.connect(mongoUrl, connectOptions);
        retryDelayMs = Number(process.env.MONGO_RETRY_DELAY_MS || 2000);
    } catch (err) {
        const msg = err && err.message ? err.message : err;
        console.error('DB connect failed:', msg);
        const delay = Math.min(maxRetryDelayMs, Math.max(500, retryDelayMs));
        retryDelayMs = Math.min(maxRetryDelayMs, retryDelayMs * 2);
        setTimeout(() => {
            connecting = false;
            connectWithRetry();
        }, delay);
        return;
    }
    connecting = false;
};

connectWithRetry().catch(() => undefined);
db.on('connected', () => console.log('DB is Connected..'));
db.on('error', (err) => console.log('DB is not Connected..', err));
db.on('disconnected', () => {
    console.log('DB is Disconnected..');
    connectWithRetry().catch(() => undefined);
});

module.exports = db;