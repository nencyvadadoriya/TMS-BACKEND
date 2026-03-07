
const mongoose = require('mongoose');
const Task = require('./src/model/Task.model');
require('dotenv').config();

async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const task = await Task.findOne({ title: /Piyush time pr time dee rha hai bass/i }).lean();
        if (task) {
            console.log('Task found:', task.title);
            console.log('latestComment:', JSON.stringify(task.latestComment, null, 2));
        } else {
            console.log('Task not found');
        }
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}
check();
