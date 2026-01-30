require("dotenv").config();
const express = require('express');
const morgan = require("morgan")
require("./src/config/db.confing")
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 9000;
const IS_VERCEL = Boolean(process.env.VERCEL);
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
if (!IS_VERCEL) {
    app.listen(PORT,(error)=>{
        if(error){
            console.log("server not started")
            return false;
        }
            console.log("server is starting")
    })
}

module.exports = app;
