require("dotenv").config();
const express = require('express');
const morgan = require("morgan")
require("./src/config/db.confing")
const cors = require("cors");
const http = require('http');
const { initSocket } = require('./src/realtime/socket');
const app = express();
const PORT = process.env.PORT || 8100;
const IS_VERCEL = Boolean(process.env.VERCEL) && require.main !== module;

// Add error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

console.log('Starting server...');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', PORT);
app.use(express.urlencoded());
app.use(express.json({ limit: '2mb' }))
app.use(morgan('dev'))

const allowedOrigins = new Set(
    String(process.env.CORS_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
);

if (process.env.FRONTEND_URL) {
    allowedOrigins.add(String(process.env.FRONTEND_URL).trim());
}

const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const corsOptions = {
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin) || localhostOriginPattern.test(origin)) return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use('/api', require('./src/routes/index'))

// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        port: PORT
    });
});

if (require.main === module && !IS_VERCEL) {
    const server = http.createServer(app);
    initSocket(server);
    server.listen(PORT,(error)=>{
        if(error){
            console.log(`server not started ${error}`)
            return false;
        }
            console.log(`server is starting ${PORT}`)
    })
}

// For Render and other platforms
if (process.env.NODE_ENV !== 'production' || require.main === module) {
    console.log('Initializing server...');
    const server = http.createServer(app);
    console.log('Socket initialization...');
    initSocket(server);
    console.log(`Attempting to listen on port ${PORT}...`);
    server.listen(PORT, '0.0.0.0', (error) => {
        if(error){
            console.error(`Server failed to start: ${error}`);
            process.exit(1);
        }
        console.log(`✅ Server successfully started on port ${PORT}`);
        console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`✅ Health check available at: http://localhost:${PORT}/health`);
    })
}

module.exports = app;
