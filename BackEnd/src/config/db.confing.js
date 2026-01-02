const mongoose = require('mongoose');

const mongoUrl = process.env.MONGODB_URI;

const db = mongoose.connection;
mongoose.connect(mongoUrl, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 0),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000)
});
db.on('connected', () => console.log('DB is Connected..'));
db.on('error', (err) => console.log('DB is not Connected..', err));
db.on('disconnected', () => console.log('DB is Disconnected..'));

module.exports = db;