const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;

const redisOptions = {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    // Retry strategy to prevent crashing the server if Redis goes down intermittently
    retryStrategy(times) {
        if (times > 3) {
            console.warn('[Redis] Connection retries exhausted. System will fallback to native MongoDB operations.');
            return null; // Stop retrying, allow graceful DB fallback
        }
        return Math.min(times * 500, 2000);
    }
};

// Required for connecting to most cloud Redis providers (e.g., Upstash, Render, Heroku)
if (redisUrl && redisUrl.startsWith('rediss://')) {
    redisOptions.tls = {
        rejectUnauthorized: false
    };
}

const redisClient = new Redis(redisUrl, redisOptions);

redisClient.on('connect', () => {
    console.log('[Redis] Connected successfully');
});

let errorLogged = false;
redisClient.on('error', (err) => {
    if (!errorLogged) {
        console.error('[Redis] Connection Error:', err.message);
        errorLogged = true;
    }
});

redisClient.on('reconnecting', () => {
    errorLogged = false;
});

module.exports = redisClient;