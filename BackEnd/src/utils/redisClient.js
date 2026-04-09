const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;

// If REDIS_URL is not set (e.g. on Render without a Redis service),
// skip creating a client entirely and export null.
// All consumers must check `if (redisClient && redisClient.status === 'ready')`
// before calling Redis — they already do this, so this is safe.
if (!redisUrl) {
    console.warn('[Redis] REDIS_URL is not set. Redis is disabled — falling back to native MongoDB operations.');
    module.exports = null;
} else {
    const redisOptions = {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        // Retry strategy to prevent crashing the server if Redis goes down intermittently
        retryStrategy(times) {
            if (times > 3) {
                if (times === 4) {
                    console.warn('[Redis] Connection retries exhausted. System will fallback to native MongoDB operations. (Retrying silently in background)');
                }
                return 5000; // Keep retrying every 5 seconds to prevent ioredis unhandled rejection crash
            }
            return Math.min(times * 500, 2000);
        }
    };

    // Required for TLS cloud Redis providers (Upstash, Render Redis, Heroku)
    if (redisUrl.startsWith('rediss://')) {
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
}
