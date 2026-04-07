require('dotenv').config({ path: '../.env' }); // Ensure variables are loaded
require('./config/db.confing');

const { Worker } = require('bullmq');
const redisClient = require('./utils/redisClient');
const { sendTaskAssignedEmail } = require('./middleware/email.message');
const { sendTaskAssignedPush } = require('./utils/pushNotifications.util');

console.log("===================================");
console.log("⚙️  Starting Dedicated Background Worker...");
console.log("===================================");

// If Redis is not configured, skip starting the BullMQ worker entirely.
if (!redisClient) {
    console.warn('[BullMQ Worker] Redis not available (REDIS_URL missing) — worker process will not start. Exiting gracefully.');
    process.exit(0);
}

const connection = redisClient.duplicate({ maxRetriesPerRequest: null });

const backgroundWorker = new Worker('backgroundJobs', async job => {
    if (job.name === 'task_assigned_notifications') {
        const { emailPayload, pushPayload } = job.data;
        // Independent try/catch for Email
        try {
            if (emailPayload) {
                await sendTaskAssignedEmail(emailPayload);
            }
        } catch (err) {
            console.error('[BullMQ] Email execution failed:', err.message);
        }

        // Independent try/catch for Push
        try {
            if (pushPayload) {
                console.log(`[BullMQ] Sending push to ${pushPayload.toEmail}`);
                await sendTaskAssignedPush(pushPayload);
            }
        } catch (err) {
            console.error('[BullMQ] Push execution failed:', err.message);
        }
    }
}, { connection });

backgroundWorker.on('completed', job => {
    console.log(`[BullMQ] Job ${job.id}:${job.name} completed rapidly behind the scenes.`);
});
backgroundWorker.on('failed', (job, err) => {
    console.error(`[BullMQ] Job ${job.id}:${job.name} failed!`, err.message);
});

backgroundWorker.on('ready', () => {
    console.log(`[BullMQ] Worker is ready and listening for jobs on 'backgroundJobs' queue.`);
});
