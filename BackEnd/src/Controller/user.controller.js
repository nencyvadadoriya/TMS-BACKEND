const User = require('../model/user.model');
const MdImpexAccess = require('../model/MdImpexAccess.model');

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");

const cloudinary = require('cloudinary').v2;


const Task = require('../model/Task.model');
const TaskHistory = require('../model/TaskHistory.model');
const Brand = require('../model/Brand.model');
const UserBrandTaskType = require('../model/UserBrandTaskType.model');
const { sendOtpEmail, sendAccountCreatedEmail } = require('../middleware/email.message');
const { _getEffectivePermissionsMap } = require('./access.controller');
const { emitUserUpserted, emitUserDeleted } = require('../realtime/userEvents');

const normalizeRole = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const normalizeRoleKey = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const ROLE_PARENTS = {
    admin: ['super_admin'],
    md_manager: ['admin'],
    ob_manager: ['admin'],
    manager: ['md_manager'],
    assistant: ['admin', 'md_manager', 'ob_manager', 'manager'],
    sub_assistance: ['admin', 'md_manager', 'ob_manager', 'manager'],
    sbm: ['admin'],
    rm: ['sbm'],
    am: ['rm'],
    sales_manager: ['sbm', 'admin', 'super_admin'],
    sales_man: ['sales_manager', 'admin', 'super_admin'],
    troubleshoot_manager: ['admin', 'md_manager'],
    marketer_manager: ['md_manager', 'admin', 'super_admin'],
};




// Display names for roles (stored in DB instead of keys)
const ROLE_DISPLAY_NAMES = {
    admin: 'Admin',
    md_manager: 'MD Manager',
    ob_manager: 'OB Manager',
    manager: 'Manager',
    assistant: 'Assistant',
    sub_assistance: 'Sub Assistance',
    sbm: 'SBM',
    rm: 'RM',
    am: 'AM',
    troubleshoot_manager: 'Troubleshoot Manager',
    marketer_manager: 'Marketer Manager',
};

const toObjectIdString = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object') return String(value._id || value.id || '').trim();
    return '';
};

const normalizeCompanyName = (value) => (value || '').toString().trim();

const syncAmAssignmentsOnRmChange = async ({ amId, oldRmId, newRmId, actorId }) => {
    // Makes AM's brand/taskType mapping follow the new RM and removes stale mappings from the old RM.
    const safeAmId = toObjectIdString(amId);
    const safeNewRmId = toObjectIdString(newRmId);
    if (!mongoose.Types.ObjectId.isValid(safeAmId)) return;
    if (!mongoose.Types.ObjectId.isValid(safeNewRmId)) return;

    // Fetch current mappings
    const [amMappings, rmMappings] = await Promise.all([
        UserBrandTaskType.find({ userId: safeAmId }).select('_id companyName brandId taskTypeIds').lean(),
        UserBrandTaskType.find({ userId: safeNewRmId }).select('_id companyName brandId brandName taskTypeIds').lean(),
    ]);

    const amKeySet = new Set(
        (amMappings || []).map((m) => `${normalizeCompanyName(m?.companyName)}::${String(m?.brandId || '')}`)
    );

    const rmByKey = new Map(
        (rmMappings || []).map((m) => [
            `${normalizeCompanyName(m?.companyName)}::${String(m?.brandId || '')}`,
            m
        ])
    );

    // Step 1: remove AM mappings that are NOT present on new RM.
    // This is the cleanup that breaks old RM/AM brand visibility.
    const rmKeySet = new Set(rmByKey.keys());
    const removeIds = (amMappings || [])
        .filter((m) => {
            const key = `${normalizeCompanyName(m?.companyName)}::${String(m?.brandId || '')}`;
            return !rmKeySet.has(key);
        })
        .map((m) => toObjectIdString(m?._id))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (removeIds.length > 0) {
        await UserBrandTaskType.deleteMany({ _id: { $in: removeIds } });
    }

    // Step 2: ensure AM has mappings for all brands that new RM has.
    const upsertOps = [];
    for (const [key, rmRow] of rmByKey.entries()) {
        if (!rmRow) continue;
        if (amKeySet.has(key)) continue;
        const companyName = normalizeCompanyName(rmRow.companyName);
        const brandId = toObjectIdString(rmRow.brandId);
        if (!companyName || !mongoose.Types.ObjectId.isValid(brandId)) continue;
        const taskTypeIds = Array.isArray(rmRow.taskTypeIds) ? rmRow.taskTypeIds : [];
        upsertOps.push({
            updateOne: {
                filter: { companyName, userId: safeAmId, brandId },
                update: {
                    $set: {
                        companyName,
                        userId: safeAmId,
                        brandId,
                        brandName: (rmRow.brandName || '').toString(),
                        taskTypeIds,
                        updatedBy: actorId || ''
                    },
                    $setOnInsert: { createdBy: actorId || '' }
                },
                upsert: true
            }
        });
    }
    if (upsertOps.length > 0) {
        await UserBrandTaskType.bulkWrite(upsertOps, { ordered: false });
    }

    // Step 3: recompute assignedBrandIds strictly from remaining mappings (taskTypeIds non-empty).
    const finalMappings = await UserBrandTaskType.find({ userId: safeAmId })
        .select('brandId taskTypeIds')
        .lean();
    const brandIds = Array.from(new Set(
        (finalMappings || [])
            .filter((m) => Array.isArray(m?.taskTypeIds) && m.taskTypeIds.length > 0)
            .map((m) => toObjectIdString(m?.brandId))
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ));
    await User.updateOne(
        { _id: safeAmId },
        { $set: { assignedBrandIds: brandIds, updatedAt: new Date() } }
    );
};

// Update AM Hierarchy (Admin/SBM only)
exports.updateAmHierarchy = async (req, res) => {
    try {
        const requesterRole = normalizeRole(req.user?.role);
        const requesterId = (req.user?.id || req.user?._id || '').toString();

        if (requesterRole !== 'admin' && requesterRole !== 'super_admin' && requesterRole !== 'sbm' && requesterRole !== 'md_manager') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const amId = String(req.params?.id || '').trim();
        const nextRmId = String(req.body?.managerId || req.body?.rmId || '').trim();
        if (!mongoose.Types.ObjectId.isValid(amId) || !mongoose.Types.ObjectId.isValid(nextRmId)) {
            return res.status(400).json({ success: false, message: 'Valid AM id and RM managerId are required' });
        }

        const [targetAm, nextRm] = await Promise.all([
            User.findById(amId).select('_id role managerId email').lean(),
            User.findById(nextRmId).select('_id role managerId email').lean(),
        ]);
        if (!targetAm) {
            return res.status(404).json({ success: false, message: 'AM user not found' });
        }
        if (normalizeRole(targetAm.role) !== 'am') {
            return res.status(400).json({ success: false, message: 'Target user must be an AM' });
        }
        if (!nextRm) {
            return res.status(404).json({ success: false, message: 'RM user not found' });
        }
        if (normalizeRole(nextRm.role) !== 'rm') {
            return res.status(400).json({ success: false, message: 'managerId must be an RM user' });
        }

        // SBM/MD Manager can only move AMs under RMs they can manage.
        if (requesterRole === 'sbm' || requesterRole === 'md_manager') {
            const canManageTarget = await canManageUserByChain({ requesterRole, requesterId, targetUser: targetAm });
            if (!canManageTarget) {
                return res.status(403).json({ success: false, message: 'Access denied.' });
            }
            const canAssignUnderManager = await canManageUserByChain({ requesterRole, requesterId, targetUser: nextRm });
            if (!canAssignUnderManager) {
                return res.status(403).json({ success: false, message: 'Access denied.' });
            }
        }

        if (!validateParentForRole({ childRole: 'am', parentRole: nextRm.role })) {
            return res.status(400).json({ success: false, message: 'Invalid manager selection for role' });
        }

        const oldRmId = targetAm?.managerId ? targetAm.managerId.toString() : '';
        const updatedUser = await User.findByIdAndUpdate(
            amId,
            { $set: { managerId: nextRmId, updatedAt: new Date() } },
            { new: true, runValidators: true }
        ).select('-password');

        try {
            await syncAmAssignmentsOnRmChange({ amId, oldRmId, newRmId: nextRmId, actorId: requesterId });
        } catch (syncErr) {
            console.error('syncAmAssignmentsOnRmChange failed:', syncErr && syncErr.message ? syncErr.message : syncErr);
        }
        const refreshedUser = await User.findById(amId).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        try {
            const obj = refreshedUser?.toObject ? refreshedUser.toObject() : refreshedUser;
            if (obj) emitUserUpserted({ ...obj, id: obj._id || obj.id });
        } catch (emitError) {
            console.error('emitUserUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
        }

        return res.status(200).json({
            success: true,
            message: 'Hierarchy updated successfully',
            user: refreshedUser || updatedUser
        });
    } catch (error) {
        console.error('Error updating AM hierarchy:', error);
        return res.status(500).json({ success: false, message: 'Error updating hierarchy', error: error.message });
    }
};

exports.uploadProfileAvatar = async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?._id || '').toString();
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: 'Avatar image is required' });
        }

        const mimetype = String(file.mimetype || '').toLowerCase();
        if (!mimetype.startsWith('image/')) {
            return res.status(400).json({ success: false, message: 'Only image files are allowed' });
        }

        const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY || process.env.API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET;
        if (!cloudName || !apiKey || !apiSecret) {
            return res.status(500).json({
                success: false,
                message: 'Failed to upload avatar',
                error: 'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET (or CLOUD_NAME/API_KEY/API_SECRET) in .env'
            });
        }
        cloudinary.config({
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret
        });
        const existingUser = await User.findById(userId).select('_id avatar avatarPublicId name email role companyName managerId assignedBrandIds assignedCompanyIds isGoogleCalendarConnected googleOAuth phone department position location createdAt updatedAt').lean();
        if (!existingUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: 'tms/profile_avatars',
                    resource_type: 'image',
                    overwrite: true,
                    transformation: [{ width: 512, height: 512, crop: 'limit' }]
                },
                (error, result) => {
                    if (error) return reject(error);
                    return resolve(result);
                }
            );
            uploadStream.end(file.buffer);
        });

        const secureUrl = (uploadResult && uploadResult.secure_url) ? String(uploadResult.secure_url) : '';
        const publicId = (uploadResult && uploadResult.public_id) ? String(uploadResult.public_id) : '';

        if (!secureUrl) {
            return res.status(500).json({ success: false, message: 'Failed to upload avatar' });
        }

        const oldPublicId = String(existingUser.avatarPublicId || '').trim();
        if (oldPublicId) {
            cloudinary.uploader.destroy(oldPublicId).catch(() => undefined);
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    avatar: secureUrl,
                    avatarPublicId: publicId,
                    updatedAt: new Date()
                }
            },
            { new: true }
        ).select('-password -resetOtp -otpExpiry -otpAttempts -otpAttemptsExpiry');

        const payload = (() => {
            try {
                const obj = updatedUser?.toObject ? updatedUser.toObject() : updatedUser;
                if (!obj) return obj;
                return {
                    ...obj,
                    id: (obj.id || obj._id || '').toString()
                };
            } catch {
                return updatedUser;
            }
        })();

        return res.status(200).json({
            success: true,
            message: 'Avatar updated successfully',
            user: payload
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to upload avatar',
            error: error.message
        });
    }
};

exports.removeProfileAvatar = async (req, res) => {
    try {
        const userId = (req.user?.id || req.user?._id || '').toString();
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME;
        const apiKey = process.env.CLOUDINARY_API_KEY || process.env.API_KEY;
        const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET;
        if (!cloudName || !apiKey || !apiSecret) {
            return res.status(500).json({
                success: false,
                message: 'Failed to remove avatar',
                error: 'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET (or CLOUD_NAME/API_KEY/API_SECRET) in .env'
            });
        }
        cloudinary.config({
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret
        });
        const existingUser = await User.findById(userId).select('_id avatarPublicId').lean();
        if (!existingUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const oldPublicId = String(existingUser.avatarPublicId || '').trim();
        if (oldPublicId) {
            cloudinary.uploader.destroy(oldPublicId).catch(() => undefined);
        }
        await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    avatar: '',
                    avatarPublicId: '',
                    updatedAt: new Date()
                }
            },
            { new: false }
        );
        return res.status(200).json({
            success: true,
            message: 'Avatar removed successfully'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to remove avatar',
            error: error.message
        });
    }
};
const isAdminLike = (role) => {
    const r = normalizeRoleKey(role);
    return r === 'admin' || r === 'super_admin';
};

const isManagerLike = (role) => {
    const r = normalizeRoleKey(role);
    return r === 'manager' || r === 'md_manager' || r === 'marketer_manager';
};

const isHierarchyManager = (role) => {
    const r = normalizeRoleKey(role);
    return r === 'admin' || r === 'super_admin' || r === 'md_manager' || r === 'ob_manager' || r === 'sbm' || r === 'rm' || r === 'manager' || r === 'marketer_manager';
};

const canManageUserByChain = async ({ requesterRole, requesterId, targetUser }) => {
    const reqRole = normalizeRoleKey(requesterRole);
    const reqId = String(requesterId || '');
    if (!reqId || !mongoose.Types.ObjectId.isValid(reqId)) return false;
    if (!targetUser) return false;

    const targetId = String(targetUser._id || targetUser.id || '');
    if (targetId && targetId === reqId) return true;

    const targetRole = normalizeRoleKey(targetUser.role);

    // Check if requester created the target user (allows creator to manage regardless of role)
    const requesterDoc = await User.findById(reqId).select('email').lean().catch(() => null);
    const requesterEmail = (requesterDoc?.email || '').toString().trim().toLowerCase();
    const targetCreatedBy = (targetUser?.createdByEmail || '').toString().trim().toLowerCase();
    if (requesterEmail && targetCreatedBy && requesterEmail === targetCreatedBy) return true;

    if (reqRole === 'super_admin') return true;

    if (reqRole === 'admin') {
        if (targetRole === 'super_admin') return false;
        if (targetRole === 'admin') return false;
        return true;
    }

    if (reqRole === 'md_manager') {
        // MD Manager should be able to manage anyone except super_admin
        if (targetRole === 'super_admin') return false;
        return true;
    }

    if (reqRole === 'ob_manager') {
        if (targetRole === 'super_admin' || targetRole === 'admin' || targetRole === 'md_manager' || targetRole === 'ob_manager') return false;
        const isAssistantLike = targetRole === 'assistant'
            || targetRole === 'assistance'
            || targetRole === 'assistence'
            || targetRole === 'assistece'
            || targetRole === 'sub_assistance'
            || targetRole === 'sub_assistence'
            || targetRole === 'sub_assistece'
            || targetRole === 'sub_assist'
            || targetRole === 'sub_assistant'
            || targetRole.includes('assistant');
        if (!isAssistantLike) return false;
    }

    if (reqRole === 'sbm') {
        if (targetRole === 'super_admin' || targetRole === 'admin' || targetRole === 'md_manager' || targetRole === 'manager' || targetRole === 'assistant') return false;
        if (targetRole === 'sbm') return false;
    }

    if (reqRole === 'rm') {
        if (targetRole !== 'am') return false;
    }

    if (reqRole === 'manager' || reqRole === 'marketer_manager') {
        const isAssistantLike = targetRole === 'assistant'
            || targetRole === 'assistance'
            || targetRole === 'assistence'
            || targetRole === 'assistece'
            || targetRole === 'sub_assistance'
            || targetRole === 'sub_assistence'
            || targetRole === 'sub_assistece'
            || targetRole === 'sub_assist'
            || targetRole === 'sub_assistant'
            || targetRole.includes('assistant');
        if (!isAssistantLike) return false;
    }

    // Legacy users might have no managerId. For md_manager/ob_manager we allow deleting assistant/sub_assistance
    // in the same company to avoid being blocked by missing chain.
    if (!targetUser.managerId && (reqRole === 'md_manager' || reqRole === 'ob_manager') && (targetRole === 'assistant' || targetRole === 'assistance' || targetRole === 'assistence' || targetRole === 'assistece' || targetRole === 'sub_assistance' || targetRole === 'sub_assistence' || targetRole === 'sub_assistece' || targetRole === 'sub_assist' || targetRole === 'sub_assistant')) {
        try {
            const requester = await User.findById(reqId).select('companyName company').lean();
            const requesterCompany = (requester?.companyName || requester?.company || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
            const targetCompany = (targetUser?.companyName || targetUser?.company || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
            if (requesterCompany && targetCompany && requesterCompany === targetCompany) return true;
        } catch {
            // ignore
        }
        return false;
    }

    let currentManagerId = targetUser.managerId;
    for (let i = 0; i < 6; i++) {
        if (!currentManagerId) return false;
        const managerIdStr = String(currentManagerId);
        if (managerIdStr === reqId) return true;
        if (!mongoose.Types.ObjectId.isValid(managerIdStr)) return false;
        const parent = await User.findById(managerIdStr).select('managerId').lean();
        if (!parent) return false;
        currentManagerId = parent.managerId;
    }
    return false;
};

const validateParentForRole = ({ childRole, parentRole }) => {
    const c = normalizeRole(childRole);
    const p = normalizeRole(parentRole);
    const allowedParents = ROLE_PARENTS[c] || [];
    if (!Array.isArray(allowedParents) || allowedParents.length === 0) return false;
    return allowedParents.includes(p);
};

// Register user
exports.registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Name, email and password are required'
            });
        }
        // Check if user exists
        const existUser = await User.findOne({ email });
        if (existUser) {
            return res.status(400).json({
                success: false,
                message: 'User already exists'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const newUser = new User({
            name,
            email,
            password: hashedPassword,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await newUser.save();
        try {
            emitUserUpserted({
                id: newUser._id,
                _id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                managerId: newUser.managerId,
                companyName: newUser.companyName,
                assignedBrandIds: Array.isArray(newUser.assignedBrandIds) ? newUser.assignedBrandIds : [],
                assignedCompanyIds: Array.isArray(newUser.assignedCompanyIds) ? newUser.assignedCompanyIds : [],
            });
        } catch (emitError) {
            console.error('emitUserUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
        }

        const userPayload = {
            id: String(newUser._id || ''),
            name: newUser.name,
            email: newUser.email,
            role: newUser.role,
            avatar: newUser.avatar,
            companyName: newUser.companyName,
            company: newUser.company,
            managerId: newUser.managerId
        };

        const token = jwt.sign(
            userPayload,
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '24h' }
        );

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            result: {
                token,
                user: userPayload
            }
        });

    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({
            success: false,
            message: 'Error registering user',
            error: error.message
        });
    }
};

// Login user
exports.loginUser = async (req, res) => {
    try {
        const email = (req.body?.email || '').toString().trim().toLowerCase();
        const password = (req.body?.password || '').toString();

        if (!email || !password) {
            return res.status(400).json({
                error: true,
                msg: 'Email and password are required'
            });
        }
        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({
                error: true,
                msg: 'User not found'
            });
        }

        // Check password
        const matchPassword = await bcrypt.compare(password, user.password);
        if (!matchPassword) {
            return res.status(400).json({
                error: true,
                msg: 'Invalid password'
            });
        }

        // Create token
        const token = jwt.sign(
            {
                id: String(user._id || ''),
                email: user.email,
                name: user.name,
                role: user.role
            },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '24h' }
        );
        // Remove password from response
        user.password = undefined;

        // Send consistent response format
        res.status(200).json({
            error: false,
            msg: 'Login successful',
            result: {
                token: token,
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    avatar: user.avatar,
                    companyName: user.companyName,
                    company: user.company,
                    managerId: user.managerId
                }
            }
        });

    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            error: true,
            msg: 'Server error during login'
        });
    }
};

// Forget Password (with better debugging)
exports.forgetPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                error: true,
                msg: 'Email is required'
            });
        }

        console.log(`📧 Forget password request for: ${email}`);

        const user = await User.findOne({ email });
        if (!user) {
            console.log(`❌ User not found: ${email}`);
            return res.status(404).json({
                error: true,
                msg: 'Email not found in our database'
            });
        }

        console.log(`✅ User found: ${user.email} (${user.name})`);

        // Generate OTP
        const OTP = Math.floor(100000 + Math.random() * 900000);
        const otpExpiry = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

        console.log(`🔢 Generated OTP: ${OTP} (expires: ${otpExpiry.toLocaleTimeString()})`);

        // Save OTP to database
        user.resetOtp = OTP;
        user.otpExpiry = otpExpiry;
        user.updatedAt = new Date();

        await user.save();
        console.log('✅ OTP saved to database');

        // Attempt to send email
        let emailSent = false;
        let emailError = null;

        try {
            console.log('📤 Calling sendOtpEmail function...');
            emailSent = await sendOtpEmail(email, OTP, user.name);

            if (emailSent) {
                console.log('✅ Email sent successfully via nodemailer');
            } else {
                emailError = 'Email service returned false';
                console.log('❌ Email service returned false');
            }
        } catch (err) {
            emailError = err.message;
            console.error('❌ Exception in sendOtpEmail:', err.message);
        }

        // Determine response based on email status
        if (emailSent) {
            return res.status(200).json({
                error: false,
                success: true,
                msg: 'OTP has been sent to your email address',
                email: email,
                timestamp: new Date().toISOString()
            });
        } else {
            console.log('⚠️ Email not sent. Returning error.');

            return res.status(500).json({
                error: true,
                success: false,
                msg: 'Failed to send OTP email. Please check server configuration (Environment Variables).',
                email: email,
                debug: {
                    emailService: 'failed',
                    error: emailError
                }
            });
        }

    } catch (error) {
        console.error('❌ Error in forgetPassword:', error);
        console.error('Stack:', error.stack);

        return res.status(500).json({
            error: true,
            msg: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const { email, OTP } = req.body;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({
                error: true,
                msg: 'User not found'
            });
        }

        // Check if OTP exists
        if (!user.resetOtp) {
            return res.status(400).json({
                error: true,
                msg: 'No OTP requested'
            });
        }

        // Check OTP expiry
        if (user.otpExpiry < new Date()) {
            return res.status(400).json({
                error: true,
                msg: 'OTP expired'
            });
        }

        // Verify OTP (direct comparison)
        if (user.resetOtp != OTP) {
            return res.status(400).json({
                error: true,
                msg: 'Invalid OTP'
            });
        }

        // Clear OTP after verification
        user.resetOtp = null;
        user.otpExpiry = null;
        await user.save();

        return res.status(200).json({
            error: false,
            success: true,
            msg: 'OTP verified successfully'
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({
            error: true,
            msg: 'Server error'
        });
    }
};

// Change password
exports.changePassword = async (req, res) => {
    try {
        const { email, newPassword } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({
                error: true,
                msg: 'User not found'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        user.updatedAt = new Date();
        await user.save();

        return res.status(200).json({
            error: false,
            success: true,
            msg: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Error changing password:', error);
        return res.status(500).json({
            error: true,
            msg: 'Error changing password'
        });
    }
};

// Get all users
exports.getAllUsers = async (req, res) => {
    try {
        const requesterRole = normalizeRole(req.user?.role);
        const requesterId = (req.user?.id || req.user?._id || '').toString();
        const normalizeText = (v) => (v == null ? '' : String(v)).trim();
        const escapeRegex = (v) => String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        let query = {};



        if (['super_admin', 'admin', 'sbm', 'rm', 'am', 'troubleshoot_manager'].includes(requesterRole)) {

            query = {};
        } else if (requesterRole === 'sales_manager') {
            const requester = await User.findById(requesterId)
                .select('companyName company managerId')
                .lean();
            const requesterCompany = normalizeText(requester?.companyName || requester?.company);
            const companySafe = requesterCompany ? escapeRegex(requesterCompany) : '';
            const companyFilter = companySafe
                ? { companyName: { $regex: `^${companySafe}$`, $options: 'i' } }
                : {};
            const managerId = toObjectIdString(requester?.managerId);

            const or = [
                { _id: requesterId },
                { role: { $in: ['admin', 'super_admin'] } },
                { role: 'sales_man', ...companyFilter }
            ];
            if (managerId && mongoose.Types.ObjectId.isValid(managerId)) {
                or.push({ _id: managerId, role: 'sbm' });
            }
            query = { $or: or };
        } else if (requesterRole === 'sales_man') {
            const requester = await User.findById(requesterId)
                .select('managerId')
                .lean();
            const managerId = toObjectIdString(requester?.managerId);

            const or = [
                { _id: requesterId },
                { role: { $in: ['admin', 'super_admin'] } }
            ];
            if (managerId && mongoose.Types.ObjectId.isValid(managerId)) {
                or.push({ _id: managerId, role: 'sales_manager' });
            }
            query = { $or: or };
        } else if (requesterRole === 'ob_manager') {
            query = {
                $or: [
                    { _id: requesterId },
                    { role: { $in: ['assistant', 'sub_assistance', 'manager', 'md_manager', 'ob_manager'] } }
                ]
            };
        } else if (requesterRole === 'md_manager') {
            const requester = await User.findById(requesterId).select('companyName company').lean();
            const requesterCompany = normalizeText(requester?.companyName || requester?.company);
            const companySafe = requesterCompany ? escapeRegex(requesterCompany) : '';
            const companyFilter = companySafe ? { companyName: { $regex: `^${companySafe}$`, $options: 'i' } } : {};
            const [managers, mdManagers, obManagers, assistants] = await Promise.all([
                User.find({ role: { $in: ['manager', 'marketer_manager'] }, ...companyFilter }).select('_id').lean(),
                User.find({ role: 'md_manager', ...companyFilter }).select('_id').lean(),
                User.find({ role: 'ob_manager', ...companyFilter }).select('_id').lean(),
                User.find({ role: { $in: ['assistant', 'sub_assistance'] }, ...companyFilter }).select('_id').lean(),
            ]);
            const managerIds = (managers || []).map(u => String(u._id));
            const mdManagerIds = (mdManagers || []).map(u => String(u._id));
            const obManagerIds = (obManagers || []).map(u => String(u._id));
            const assistantIds = (assistants || []).map(u => String(u._id));

            const ids = [requesterId, ...mdManagerIds, ...managerIds, ...obManagerIds, ...assistantIds]
                .filter(Boolean)
                .filter((v, idx, arr) => arr.indexOf(v) === idx);

            query = { _id: { $in: ids } };
            if (companySafe) {

                query = {

                    $or: [

                        { companyName: { $regex: `^${companySafe}$`, $options: 'i' } },

                        { company: { $regex: `^${companySafe}$`, $options: 'i' } },

                        { _id: requesterId }

                    ]

                };

            } else {

                query = { _id: requesterId };

            }

        } else if (requesterRole === 'manager' || requesterRole === 'marketer_manager') {
            query = {
                $or: [
                    { _id: requesterId },
                    { role: 'assistant' },
                    { role: 'sub_assistance' },
                    { role: 'manager' },
                    { role: 'marketer_manager' },
                    { role: 'ob_manager' }
                ]
            };
        } else if (
            requesterRole === 'assistant' ||
            requesterRole === 'sub_assistance' ||
            requesterRole === 'sub_assistence' ||
            requesterRole === 'sub_assist' ||
            requesterRole === 'sub_assistant'
        ) {
            let requesterCompany = normalizeText(req.user?.companyName || req.user?.company);
            if (!requesterCompany && requesterId) {
                const doc = await User.findById(requesterId).select('companyName').lean();
                requesterCompany = normalizeText(doc?.companyName);
            }
            const companySafe = requesterCompany ? escapeRegex(requesterCompany) : '';
            const sameCompanyAssistants = {
                role: { $in: ['assistant', 'sub_assistance', 'sub_assistence', 'sub_assist', 'sub_assistant'] }
            };
            if (companySafe) {
                sameCompanyAssistants.companyName = { $regex: `^${companySafe}$`, $options: 'i' };
            }
            query = {
                $or: [
                    { _id: requesterId },
                    sameCompanyAssistants
                ]
            };
        } else {
            query = { _id: requesterId };
        }

        // Pagination support
        const page = parseInt(req.query?.page) || 1;
        const limit = parseInt(req.query?.limit) || 1000; // default to 1000 to remain backward compatible if no limit is passed initially
        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
            User.find(query)
                .select('-password -resetOtp -otpExpiry')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            User.countDocuments(query)
        ]);

        res.status(200).json({
            success: true,
            message: 'Users fetched successfully',
            count: users.length,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            data: users
        });

    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching users'
        });
    }
};

exports.currentUser = async (req, res) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (token) {
            const decoded = jwt.decode(token);
        }
        const userId = req.user.id;
        if (!userId) {
            return res.status(400).json({
                error: true,
                msg: "User ID not found in request"
            });
        }
        const user = await User.findById(userId).select('-password -__v');

        if (!user) {
            return res.status(404).json({
                error: true,
                msg: "User not found in database"
            });
        }

        // Safe check for name
        const userName = user.name || 'User';
        const userAvatar = user.avatar || (userName ? userName.charAt(0) : 'U');

        const assignedBrandIds = Array.isArray(user.assignedBrandIds) ? user.assignedBrandIds : [];
        const assignedBrands = assignedBrandIds.length
            ? await Brand.find({ _id: { $in: assignedBrandIds } })
                .select('name company status createdAt updatedAt owner')
                .lean()
            : [];

        const effectivePermissions = await _getEffectivePermissionsMap(user._id);

        return res.status(200).json({
            error: false,
            msg: "Current user fetched successfully",
            result: {
                id: user._id,
                _id: user._id,
                name: userName,
                email: user.email || '',
                role: user.role || 'user',
                managerId: user.managerId || null,
                companyName: user.companyName || '',
                assignedBrandIds: user.assignedBrandIds || [],
                assignedBrands: (assignedBrands || []).map(b => ({ ...b, id: b._id })),
                avatar: userAvatar,
                phone: user.phone || '',
                department: user.department || '',
                location: user.location || '',
                joinDate: user.createdAt || '',
                bio: user.about || user.bio || '',
                skills: user.skills || [],
                isActive: user.isActive !== false,
                assignedTasks: user.assignedTasks || 0,
                completedTasks: user.completedTasks || 0,
                pendingTasks: user.pendingTasks || 0,
                overdueTasks: user.overdueTasks || 0,
                permissions: effectivePermissions
            }
        });

    } catch (error) {
        console.error("❌ Current User Error:", error);
        return res.status(500).json({
            error: true,
            msg: "Internal server error",
            details: error.message
        });
    }
};

exports.approve = async (req, res) => {
    try {
        const { id } = req.params;
        const { completedApproval } = req.body;

        const task = await Task.findByIdAndUpdate(
            id,
            {
                completedApproval,
                ...(completedApproval && { status: 'completed' })
            },
            { new: true }
        );

        // History add karo
        if (completedApproval) {
            await TaskHistory.create({
                taskId: id,
                action: 'assigner_permanent_approved',
                message: 'Task PERMANENTLY approved by Assigner',
                userId: req.user.id,
                userName: req.user.name,
                userEmail: req.user.email,
                userRole: req.user.role
            });
        }

        res.json(task);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Create User (Admin only)
exports.createUser = async (req, res) => {
    try {
        // middleware assures req.user exists
        const requesterRole = normalizeRole(req.user?.role);
        const requesterId = (req.user?.id || req.user?._id || '').toString();
        const isSuperAdmin = requesterRole === 'super_admin';
        const isAdmin = requesterRole === 'admin';
        const isMdManager = requesterRole === 'md_manager';
        const isObManager = requesterRole === 'ob_manager';
        const isManager = requesterRole === 'manager';
        const isSbm = requesterRole === 'sbm';
        const isRm = requesterRole === 'rm';

        if (!isSuperAdmin && !isAdmin && !isMdManager && !isObManager && !isManager && !isSbm && !isRm) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.'
            });
        }

        const { name, email, password, role, phone, department, position, companyName } = req.body;

        const safeEmail = (email || '').toString().trim().toLowerCase();

        if (!name || !safeEmail || !password) {
            return res.status(400).json({
                success: false,
                message: 'Name, email and password are required'
            });
        }

        const existUser = await User.findOne({ email: safeEmail });
        if (existUser) {
            return res.status(400).json({
                success: false,
                message: 'User already exists'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const normalizedRole = normalizeRole(role || 'assistant');
        const roleHasParent = Array.isArray(ROLE_PARENTS[normalizedRole]) && ROLE_PARENTS[normalizedRole].length > 0;
        const requestedManagerId = String(req.body?.managerId || '').trim();

        const rawAssignedBrandIds = Array.isArray(req.body?.assignedBrandIds) ? req.body.assignedBrandIds : [];
        const safeAssignedBrandIds = rawAssignedBrandIds
            .map((v) => {
                if (!v) return '';
                if (typeof v === 'string') return v.trim();
                if (typeof v === 'object') return String(v._id || v.id || '').trim();
                return '';
            })
            .filter((id) => mongoose.Types.ObjectId.isValid(id));

        if (isManager && normalizedRole !== 'assistant' && normalizedRole !== 'sub_assistance') {
            return res.status(403).json({
                success: false,
                message: 'Managers can only create assistant or sub assistance users'
            });
        }

        if (isObManager && normalizedRole !== 'assistant' && normalizedRole !== 'sub_assistance') {
            return res.status(403).json({
                success: false,
                message: 'OB Managers can only create assistant or sub assistance users'
            });
        }



        if (isMdManager) {

            // MD Manager can create any role for MD Impex users - no restrictions

            // All roles are allowed including custom roles

        }

        if (isSbm && normalizedRole !== 'rm' && normalizedRole !== 'am' && normalizedRole !== 'sales_manager' && normalizedRole !== 'sales_man') {
            return res.status(403).json({
                success: false,
                message: 'SBM can only create RM, AM, Sales Manager or Sales Man users'
            });
        }

        if (isRm && normalizedRole !== 'am') {
            return res.status(403).json({
                success: false,
                message: 'RM can only create AM users'
            });
        }

        if (isAdmin && normalizedRole === 'super_admin') {
            return res.status(403).json({
                success: false,
                message: 'Admins cannot create super admin users'
            });
        }

        if (isSuperAdmin && normalizedRole === 'super_admin') {
            return res.status(403).json({
                success: false,
                message: 'Super Admin cannot create super admin users'
            });
        }

        let computedManagerId = null;

        if (isManager) computedManagerId = requesterId;
        if (isMdManager) computedManagerId = requesterId;
        if (isObManager) computedManagerId = requesterId;
        if (isSbm && normalizedRole === 'rm') computedManagerId = requesterId;
        if (isRm) computedManagerId = requesterId;

        if (isSbm && (normalizedRole === 'am' || normalizedRole === 'sales_manager' || normalizedRole === 'sales_man')) {
            if (!mongoose.Types.ObjectId.isValid(requestedManagerId)) {
                if (normalizedRole === 'sales_manager') {
                    computedManagerId = requesterId;
                } else {
                    return res.status(400).json({ success: false, message: 'managerId is required for this role' });
                }
            } else {
                const managerUser = await User.findById(requestedManagerId).select('role managerId').lean();
                if (!managerUser) {
                    return res.status(400).json({ success: false, message: 'Invalid manager selection' });
                }
                if (!validateParentForRole({ childRole: normalizedRole, parentRole: managerUser.role })) {
                    return res.status(400).json({ success: false, message: 'Invalid manager selection for role' });
                }
                const canManageTarget = await canManageUserByChain({ requesterRole, requesterId, targetUser: managerUser });
                if (!canManageTarget) {
                    return res.status(403).json({ success: false, message: 'Access denied.' });
                }
                computedManagerId = requestedManagerId;
            }
        }

        if (isSuperAdmin) {
            if (normalizedRole === 'admin') {
                computedManagerId = requesterId;
            } else {
                if (roleHasParent) {
                    if (!mongoose.Types.ObjectId.isValid(requestedManagerId)) {
                        return res.status(400).json({ success: false, message: 'managerId is required for this role' });
                    }
                    const managerUser = await User.findById(requestedManagerId).select('role managerId').lean();
                    if (!managerUser) {
                        return res.status(400).json({ success: false, message: 'Invalid manager selection' });
                    }
                    if (!validateParentForRole({ childRole: normalizedRole, parentRole: managerUser.role })) {
                        return res.status(400).json({ success: false, message: 'Invalid manager selection for role' });
                    }
                    computedManagerId = requestedManagerId;
                } else {
                    computedManagerId = null;
                }
            }
        }

        if (isAdmin) {
            if (normalizedRole === 'md_manager' || normalizedRole === 'sbm' || normalizedRole === 'ob_manager') {
                computedManagerId = requesterId;
            } else if (normalizedRole === 'admin') {
                const requesterUser = await User.findById(requesterId).select('managerId role').lean();
                const parentId = requesterUser?.managerId ? requesterUser.managerId.toString() : '';
                if (!mongoose.Types.ObjectId.isValid(parentId)) {
                    return res.status(400).json({ success: false, message: 'managerId is required for this role' });
                }
                computedManagerId = parentId;
            } else {
                if (!roleHasParent) {
                    computedManagerId = null;
                } else {
                    if (!mongoose.Types.ObjectId.isValid(requestedManagerId)) {
                        if (normalizedRole === 'assistant') {
                            computedManagerId = requesterId;
                            // skip managerId validation for assistant when admin directly creates it
                            // (admin can still optionally pass managerId to assign under someone)
                            // fall through
                        } else {
                            return res.status(400).json({ success: false, message: 'managerId is required for this role' });
                        }
                    }
                    if (mongoose.Types.ObjectId.isValid(requestedManagerId)) {
                        const managerUser = await User.findById(requestedManagerId).select('role managerId').lean();
                        if (!managerUser) {
                            return res.status(400).json({ success: false, message: 'Invalid manager selection' });
                        }
                        if (!validateParentForRole({ childRole: normalizedRole, parentRole: managerUser.role })) {
                            return res.status(400).json({ success: false, message: 'Invalid manager selection for role' });
                        }
                        const canAssignUnderManager = await canManageUserByChain({ requesterRole, requesterId, targetUser: managerUser });
                        if (!canAssignUnderManager) {
                            return res.status(403).json({ success: false, message: 'Access denied.' });
                        }
                        computedManagerId = requestedManagerId;
                    }
                }
            }
        }

        if ((normalizedRole === 'assistant' || normalizedRole === 'sub_assistance') && (isAdmin || isSuperAdmin) && !mongoose.Types.ObjectId.isValid(requestedManagerId)) {
            computedManagerId = null;
        }

        const newUser = new User({
            name,
            email: safeEmail,
            password: hashedPassword,

            role: ROLE_DISPLAY_NAMES[normalizedRole] || normalizedRole,

            managerId: computedManagerId,
            // If a manager creates an assistant, only assign what the manager explicitly selects
            assignedBrandIds: safeAssignedBrandIds,
            phone: phone || '',
            department: department || '',
            position: position || '',
            companyName: (companyName || '').toString().trim(),
            createdByEmail: (req.user?.email || '').toString().trim().toLowerCase(),
            createdByName: (req.user?.name || '').toString().trim(),
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await newUser.save();
        try {
            emitUserUpserted({
                id: newUser._id,
                _id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                managerId: newUser.managerId,
                companyName: newUser.companyName,
                assignedBrandIds: Array.isArray(newUser.assignedBrandIds) ? newUser.assignedBrandIds : [],
                assignedCompanyIds: Array.isArray(newUser.assignedCompanyIds) ? newUser.assignedCompanyIds : [],
            });
        } catch (emitError) {
            console.error('emitUserUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
        }

        let emailSent = false;
        try {
            console.log('📤 Attempting to send account created email', {
                to: newUser.email,
                createdBy: req.user?.email,
                role: newUser.role
            });

            emailSent = await sendAccountCreatedEmail({
                toEmail: newUser.email,
                toName: newUser.name,
                createdByName: req.user?.name || 'User',
                createdByEmail: req.user?.email,
                role: newUser.role,
                password
            });

            if (!emailSent) {
                console.error('❌ Account created email returned false', {
                    to: newUser.email,
                    createdBy: req.user?.email
                });
            }
        } catch (err) {
            console.error('❌ Account created email threw an error:', err?.message || err);
        }

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            emailSent,
            data: {
                id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role
            }
        });

    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating user',
            error: error.message
        });
    }
};
exports.updateUser = async (req, res) => {
    try {
        const requesterRole = normalizeRole(req.user?.role);
        const requesterId = (req.user?.id || req.user?._id || '').toString();

        const requesterRoleKey = normalizeRoleKey(requesterRole);


        const { id } = req.params;
        const target = await User.findById(id).select('_id role managerId createdByEmail companyName company').lean();

        if (!target) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const normalizeCompanyKey = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '');
        const isSpeedEcomTarget = normalizeCompanyKey(target?.companyName || target?.company || '') === 'speedecom';
        const canAmEditRoleForSpeedEcom = requesterRoleKey === 'am' && isSpeedEcomTarget;
        const canSbmEditRoleForSpeedEcom = requesterRoleKey === 'sbm' && isSpeedEcomTarget;
        const canNonAdminEditSpeedEcomRole = canAmEditRoleForSpeedEcom || canSbmEditRoleForSpeedEcom;

        if (!isAdminLike(requesterRole) && !isHierarchyManager(requesterRole) && !canNonAdminEditSpeedEcomRole) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        const allowed = canAmEditRoleForSpeedEcom || canSbmEditRoleForSpeedEcom
            ? true
            : await canManageUserByChain({ requesterRole, requesterId, targetUser: target });

        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.'
            });
        }

        const updates = req.body;

        if (Object.prototype.hasOwnProperty.call(updates || {}, 'role')) {
            const requestedRole = normalizeRoleKey((updates || {}).role);
            const isSpeedEcomOperation = canAmEditRoleForSpeedEcom || canSbmEditRoleForSpeedEcom;

            let canSetRole = false;
            if (isSpeedEcomOperation) {
                const allowedSpeedRoles = new Set(['sbm', 'rm', 'am']);
                canSetRole = allowedSpeedRoles.has(requestedRole);
            } else if (isAdminLike(requesterRole) || requesterRoleKey === 'md_manager') {
                canSetRole = true;
            }

            if (!canSetRole) {
                delete updates.role;
            } else {
                if (isSpeedEcomOperation) {
                    // AM/SBM special-case: only allow updating role; strip other fields for safety.
                    Object.keys(updates || {}).forEach((k) => {
                        if (k !== 'role') delete updates[k];
                    });
                }
                updates.role = ROLE_DISPLAY_NAMES[requestedRole] || requestedRole;
            }
        }

        if (Object.prototype.hasOwnProperty.call(updates || {}, 'managerId')) {
            const effectiveTargetRole = normalizeRoleKey(
                Object.prototype.hasOwnProperty.call(updates || {}, 'role')
                    ? (updates || {}).role
                    : target?.role
            );
            const nextManagerId = String((updates || {}).managerId || '').trim();

            if (!ROLE_PARENTS[effectiveTargetRole]) {
                delete updates.managerId;
            } else if (!mongoose.Types.ObjectId.isValid(nextManagerId)) {
                delete updates.managerId;
            } else if (!isAdminLike(requesterRole) && requesterRoleKey !== 'md_manager' && nextManagerId !== requesterId) {
                delete updates.managerId;
            } else {
                const managerUser = await User.findById(nextManagerId).select('role managerId').lean();
                if (!managerUser) {
                    delete updates.managerId;
                } else if (!validateParentForRole({ childRole: effectiveTargetRole, parentRole: managerUser.role })) {
                    delete updates.managerId;
                } else {
                    const canAssignUnderManager = await canManageUserByChain({ requesterRole, requesterId, targetUser: managerUser });
                    if (!canAssignUnderManager) {
                        delete updates.managerId;
                    } else {
                        updates.managerId = nextManagerId;
                    }
                }
            }
        }

        if (Object.prototype.hasOwnProperty.call(updates || {}, 'assignedBrandIds')) {
            const raw = Array.isArray(updates?.assignedBrandIds) ? updates.assignedBrandIds : [];
            updates.assignedBrandIds = raw
                .map((v) => {
                    if (!v) return '';
                    if (typeof v === 'string') return v.trim();
                    if (typeof v === 'object') return String(v._id || v.id || '').trim();
                    return '';
                })
                .filter((brandId) => mongoose.Types.ObjectId.isValid(brandId));
        }

        // Prevent password update through this route for security, use change-password instead or handle carefully
        if (updates.password) {
            updates.password = await bcrypt.hash(updates.password, 10);
        }

        const updatedUser = await User.findByIdAndUpdate(
            id,
            { ...updates, updatedAt: new Date() },
            { new: true, runValidators: true }
        ).select('-password');
        try {
            const obj = updatedUser?.toObject ? updatedUser.toObject() : updatedUser;
            console.error('emitUserUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
        } catch (emitError) {
            console.error('emitUserUpserted failed:', emitError && emitError.message ? emitError.message : emitError);
        }

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'User updated successfully',
            user: updatedUser
        });

    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating user',
            error: error.message
        });
    }
};

// Delete User (Admin only)
exports.deleteUser = async (req, res) => {
    try {
        const requesterRole = normalizeRole(req.user?.role);
        const requesterId = (req.user?.id || req.user?._id || '').toString();

        if (!isAdminLike(requesterRole) && !isHierarchyManager(requesterRole)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.'
            });
        }

        const { id } = req.params;

        // Prevent deleting themselves
        if (id === req.user.id) {
            return res.status(400).json({
                success: false,
                message: 'You cannot delete yourself'
            });
        }

        const userToDelete = await User.findById(id).select('_id email role managerId companyName createdByEmail').lean();

        const allowed = await canManageUserByChain({ requesterRole, requesterId, targetUser: userToDelete });
        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.'
            });
        }

        if (!userToDelete) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }



        const originalEmail = (userToDelete.email || '').toString().trim().toLowerCase();
        const tombstoneEmail = originalEmail
            ? `${originalEmail}.deleted.${id}.${Date.now()}`
            : '';

        if (originalEmail && tombstoneEmail) {
            await Task.updateMany(
                { assignedTo: originalEmail },
                { $set: { assignedTo: tombstoneEmail } }
            );

            await Task.updateMany(
                { assignedBy: originalEmail },
                { $set: { assignedBy: tombstoneEmail } }
            );

            await Brand.updateMany(
                { 'collaborators.email': originalEmail },
                { $set: { 'collaborators.$[c].email': tombstoneEmail, 'collaborators.$[c].status': 'removed' } },
                { arrayFilters: [{ 'c.email': originalEmail }] }
            );
        }

        const deletedUser = await User.findByIdAndDelete(id);
        try {
            emitUserDeleted({ userId: id, companyName: userToDelete?.companyName || '' });
        } catch (emitError) {
            console.error('emitUserDeleted failed:', emitError && emitError.message ? emitError.message : emitError);
        }

        if (!deletedUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting user',
            error: error.message
        });
    }
};