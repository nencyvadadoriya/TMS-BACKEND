require('dotenv').config({ path: '../.env' }); // Ensure variables are loaded
require('./config/db.confing');

const { Worker } = require('bullmq');
const redisClient = require('./utils/redisClient');

// Import models for background tasks
const Task = require('./model/Task.model');
const Brand = require('./model/Brand.model');
const User = require('./model/user.model');
const mongoose = require('mongoose');

const normalizeEmail = (email) => (email || '').toString().trim().toLowerCase();

async function processAnalysisReportFetch(job) {
    const { match } = job.data;
    console.log('[BullMQ] Fetching analysis report data for job', job.id);
    
    // Safety fallback
    if (!match) throw new Error('No match query provided for analysis report fetch');
    
    // Fix dates since they were JSON stringified
    if (match.createdAt) {
        if (match.createdAt.$gte) match.createdAt.$gte = new Date(match.createdAt.$gte);
        if (match.createdAt.$lte) match.createdAt.$lte = new Date(match.createdAt.$lte);
    }
    
    const tasks = await Task.find(match).sort({ createdAt: -1 }).lean();
    
    const emails = Array.from(
        new Set(
            tasks
                .flatMap((t) => [t?.assignedTo, t?.assignedBy])
                .filter((e) => typeof e === 'string' && e.trim())
                .map((e) => normalizeEmail(e))
                .filter(Boolean)
        )
    );

    const brandIds = Array.from(
        new Set(
            tasks
                .map((t) => (t?.brandId ? t.brandId.toString() : ''))
                .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
        )
    );

    const [users, brands] = await Promise.all([
        emails.length
            ? User.find({ email: { $in: emails } })
                .select('_id name email avatar role')
                .lean()
            : Promise.resolve([]),
        brandIds.length
            ? Brand.find({ _id: { $in: brandIds } })
                .select('_id name groupNumber company')
                .lean()
            : Promise.resolve([])
    ]);

    const userByEmail = new Map(users.map((u) => [normalizeEmail(u.email), u]));
    const brandById = new Map(brands.map((b) => [b._id.toString(), b]));

    const tasksWithUserDetails = tasks.map((task) => {
        const assignedToUser = typeof task.assignedTo === 'string'
            ? userByEmail.get(normalizeEmail(task.assignedTo))
            : null;
        const assignedByUser = typeof task.assignedBy === 'string'
            ? userByEmail.get(normalizeEmail(task.assignedBy))
            : null;

        const brandIdKey = task?.brandId ? task.brandId.toString() : '';
        const brandDoc = brandIdKey ? brandById.get(brandIdKey) : null;
        const resolvedBrandName = (brandDoc?.name || task?.brand || '').toString();

        const brandDetails = brandDoc ? {
            id: brandDoc._id.toString(),
            name: brandDoc.name,
            groupNumber: brandDoc.groupNumber,
            company: brandDoc.company
        } : null;

        return {
            ...task,
            id: task._id,
            brand: resolvedBrandName,
            brandDetails,
            assignedToUser: assignedToUser ? {
                id: assignedToUser._id,
                name: assignedToUser.name,
                email: assignedToUser.email,
                avatar: assignedToUser.avatar,
                role: assignedToUser.role,
            } : { email: task.assignedTo },
            assignedByUser: assignedByUser ? {
                id: assignedByUser._id,
                name: assignedByUser.name,
                email: assignedByUser.email,
                avatar: assignedByUser.avatar,
                role: assignedByUser.role,
            } : { email: task.assignedBy }
        };
    });

    const result = {
        totalData: tasksWithUserDetails.length,
        tasks: tasksWithUserDetails
    };
    
    // Store in redis with 1 hour TTL
    await redisClient.setex(`analysis_report:${job.id}`, 3600, JSON.stringify(result));
    console.log(`[BullMQ] Processed ${tasksWithUserDetails.length} tasks for analysis report ${job.id}`);
}

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
    
    if (job.name === 'analysis_report_fetch') {
        await processAnalysisReportFetch(job);
        return;
    }

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
