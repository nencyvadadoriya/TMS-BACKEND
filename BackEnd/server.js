require("dotenv").config();
const express = require('express');
const db = require("./src/config/db.confing")
const { startGoogleTasksStatusSync, startGoogleTasksImportSync } = require('./src/utils/googleTasksSync.job');
const app = express();
const PORT = process.env.PORT || 9000;
const cors = require("cors");

const IS_VERCEL = Boolean(process.env.VERCEL);

const allowedOrigins = new Set(
    String(process.env.CORS_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
);
if (process.env.FRONTEND_URL) {
    allowedOrigins.add(String(process.env.FRONTEND_URL).trim());
}
allowedOrigins.add('http://localhost:5173');
allowedOrigins.add('http://localhost:9000');
allowedOrigins.add('https://tms-frontend-wxyr.onrender.com');

const corsOptions = {
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ strict: false }))
app.use(express.urlencoded({ extended: true }));


app.use('/api', require('./src/routes/index'))

db.once('connected', () => {
    const enabledDefault = IS_VERCEL ? 'false' : 'true';
    const enabled = String(process.env.GOOGLE_TASKS_SYNC_ENABLED || enabledDefault).toLowerCase() !== 'false';
    if (!enabled) return;

    const intervalMinutes = Number(process.env.GOOGLE_TASKS_SYNC_INTERVAL_MINUTES || 5);
    startGoogleTasksStatusSync({ intervalMinutes });

    const importEnabledDefault = 'false';
    const importEnabled = String(process.env.GOOGLE_TASKS_IMPORT_ENABLED || importEnabledDefault).toLowerCase() !== 'false';
    if (!importEnabled) return;

    const importIntervalMinutes = Number(process.env.GOOGLE_TASKS_IMPORT_INTERVAL_MINUTES || 1);
    startGoogleTasksImportSync({ intervalMinutes: importIntervalMinutes });
});

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