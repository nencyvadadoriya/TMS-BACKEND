const redisClient = require('./redisClient');

/**
 * Invalidates (deletes) all cached analysis reports in Redis.
 * Useful when a task, brand, or user is updated, as reports depend on this data.
 */
const invalidateAnalysisReportCache = async () => {
    if (!redisClient || redisClient.status !== 'ready') {
        return;
    }

    try {
        const stream = redisClient.scanStream({
            match: 'analysis_report:*',
            count: 100
        });

        stream.on('data', async (keys) => {
            if (keys.length > 0) {
                const pipeline = redisClient.pipeline();
                keys.forEach(key => {
                    pipeline.del(key);
                });
                await pipeline.exec();
            }
        });

        stream.on('end', () => {
            console.log('[Redis] Analysis report cache invalidation sweep completed.');
        });

        stream.on('error', (err) => {
            console.error('[Redis] Cache invalidation error:', err.message);
        });
    } catch (error) {
        console.error('[Redis] Failed to invalidate cache:', error.message);
    }
};

module.exports = {
    invalidateAnalysisReportCache
};
