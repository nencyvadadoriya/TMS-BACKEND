const mongoose = require('mongoose');

const permissionEnum = ['allow', 'deny', 'own', 'team'];

const accessModuleSchema = new mongoose.Schema({
    moduleId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    isDeleted: {
        type: Boolean,
        default: false,
    },
    defaults: {
        type: Map,
        of: { type: String, enum: permissionEnum },
        default: {},
    },
}, { timestamps: true });

module.exports = mongoose.model('AccessModule', accessModuleSchema);
