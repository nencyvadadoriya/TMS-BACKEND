
const mongoose = require('mongoose');
const Task = require('./src/model/Task.model');
const Comment = require('./src/model/Comment.model');
require('dotenv').config();

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const tasks = await Task.find({ isDeleted: { $ne: true } });
        console.log(`Found ${tasks.length} tasks to check.`);

        let updatedCount = 0;
        for (const task of tasks) {
            if (task.comments && task.comments.length > 0) {
                // Find the most recent comment
                const latestCommentDoc = await Comment.findOne({ taskId: task._id }).sort({ createdAt: -1 }).lean();

                if (latestCommentDoc) {
                    task.latestComment = {
                        content: latestCommentDoc.content,
                        userName: latestCommentDoc.userName,
                        userEmail: latestCommentDoc.userEmail,
                        createdAt: latestCommentDoc.createdAt
                    };
                    await task.save();
                    updatedCount++;
                }
            }
        }

        console.log(`Successfully updated ${updatedCount} tasks with latestComment field.`);
        await mongoose.disconnect();
    } catch (err) {
        console.error('Migration failed:', err);
    }
}

migrate();
