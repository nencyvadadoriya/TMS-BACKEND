const mongoose = require('mongoose');

const permissionEnum = ['allow', 'deny', 'own', 'team'];

const userPermissionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    moduleId: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    value: {
        type: String,
        enum: permissionEnum,
        required: true,
    },
}, { timestamps: true });

userPermissionSchema.index({ userId: 1, moduleId: 1 }, { unique: true });

module.exports = mongoose.model('UserPermission', userPermissionSchema);
