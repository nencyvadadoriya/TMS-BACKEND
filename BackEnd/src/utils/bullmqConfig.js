const { Queue } = require('bullmq');
const redisClient = require('./redisClient');

const connection = redisClient.duplicate({ maxRetriesPerRequest: null });

const backgroundQueue = new Queue('backgroundJobs', { connection });

module.exports = { backgroundQueue };
