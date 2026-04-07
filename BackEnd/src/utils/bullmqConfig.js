const { Queue } = require('bullmq');
const redisClient = require('./redisClient');

// If Redis is not configured, skip creating the queue entirely.
// Tasks that rely on BullMQ will simply skip queuing (fire-and-forget inline instead).
if (!redisClient) {
    console.warn('[BullMQ] Redis not available — backgroundQueue is disabled. Jobs will be skipped.');
    module.exports = { backgroundQueue: null };
} else {
    const connection = redisClient.duplicate({ maxRetriesPerRequest: null });
    const backgroundQueue = new Queue('backgroundJobs', { connection });
    module.exports = { backgroundQueue };
}
