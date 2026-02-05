const User = require('../model/user.model');

const mongoose = require('mongoose');

const bcrypt = require('bcrypt');

const jwt = require("jsonwebtoken");



const cloudinary = require('cloudinary').v2;





const Task = require('../model/Task.model');

const TaskHistory = require('../model/TaskHistory.model');

const Brand = require('../model/Brand.model');

const { sendOtpEmail, sendAccountCreatedEmail } = require('../middleware/email.message');

const { _getEffectivePermissionsMap } = require('./access.controller');



const normalizeRole = (value) => String(value || '').trim().toLowerCase();



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



        cloudinary.config({

            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,

            api_key: process.env.CLOUDINARY_API_KEY,

            api_secret: process.env.CLOUDINARY_API_SECRET

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



const isAdminLike = (role) => {

    const r = normalizeRole(role);

    return r === 'admin' || r === 'super_admin';

};



const isManagerLike = (role) => {

    const r = normalizeRole(role);

    return r === 'manager' || r === 'md_manager';

};



const isHierarchyManager = (role) => {

    const r = normalizeRole(role);

    return r === 'admin' || r === 'super_admin' || r === 'md_manager' || r === 'ob_manager' || r === 'sbm' || r === 'rm' || r === 'manager';

};



const canManageUserByChain = async ({ requesterRole, requesterId, targetUser }) => {

    const reqRole = normalizeRole(requesterRole);

    const reqId = String(requesterId || '');

    if (!reqId || !mongoose.Types.ObjectId.isValid(reqId)) return false;

    if (!targetUser) return false;



    const targetId = String(targetUser._id || targetUser.id || '');

    if (targetId && targetId === reqId) return true;



    const targetRole = normalizeRole(targetUser.role);



    if (reqRole === 'super_admin') return true;



    if (reqRole === 'admin') {

        if (targetRole === 'super_admin') return false;

        if (targetRole === 'admin') return false;

    }



    if (reqRole === 'md_manager') {

        if (targetRole === 'super_admin' || targetRole === 'admin' || targetRole === 'md_manager') return false;

        if (targetRole === 'ob_manager') return false;

        if (targetRole === 'sbm' || targetRole === 'rm' || targetRole === 'am') return false;

    }



    if (reqRole === 'ob_manager') {

        if (targetRole === 'super_admin' || targetRole === 'admin' || targetRole === 'md_manager' || targetRole === 'ob_manager') return false;

        if (targetRole !== 'assistant' && targetRole !== 'sub_assistance') return false;

    }



    if (reqRole === 'sbm') {

        if (targetRole === 'super_admin' || targetRole === 'admin' || targetRole === 'md_manager' || targetRole === 'manager' || targetRole === 'assistant') return false;

        if (targetRole === 'sbm') return false;

    }



    if (reqRole === 'rm') {

        if (targetRole !== 'am') return false;

    }



    if (reqRole === 'manager') {

        if (targetRole !== 'assistant' && targetRole !== 'sub_assistance') return false;

    }



    // Legacy users might have no managerId. For md_manager/ob_manager we allow deleting assistant/sub_assistance

    // in the same company to avoid being blocked by missing chain.

    if (!targetUser.managerId && (reqRole === 'md_manager' || reqRole === 'ob_manager') && (targetRole === 'assistant' || targetRole === 'sub_assistance')) {

        try {

            const requester = await User.findById(reqId).select('companyName').lean();

            const requesterCompany = (requester?.companyName || '').toString().trim().toLowerCase();

            const targetCompany = (targetUser?.companyName || '').toString().trim().toLowerCase();

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



        const userPayload = {

            id: newUser._id,

            name: newUser.name,

            email: newUser.email,

            role: newUser.role

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

                id: user._id,

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

                    role: user.role

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



        let query = {};



        if (['super_admin', 'admin', 'sbm', 'rm', 'am'].includes(requesterRole)) {

            query = {};

        } else if (requesterRole === 'ob_manager') {

            query = {

                $or: [

                    { _id: requesterId },

                    { role: { $in: ['assistant', 'sub_assistance', 'manager', 'md_manager', 'ob_manager'] } }

                ]

            };

        } else if (requesterRole === 'md_manager') {

            const managers = await User.find({ role: 'manager', managerId: requesterId }).select('_id').lean();

            const managerIds = (managers || []).map(u => String(u._id));



            const obManagers = await User.find({ role: 'ob_manager' }).select('_id').lean();

            const obManagerIds = (obManagers || []).map(u => String(u._id));



            const assistants = await User.find({ role: { $in: ['assistant', 'sub_assistance'] } }).select('_id').lean();

            const assistantIds = (assistants || []).map(u => String(u._id));



            const ids = [requesterId, ...managerIds, ...obManagerIds, ...assistantIds]

                .filter(Boolean)

                .filter((v, idx, arr) => arr.indexOf(v) === idx);



            query = { _id: { $in: ids } };

        } else if (requesterRole === 'manager') {

            query = {

                $or: [

                    { _id: requesterId },

                    { role: 'assistant' },

                    { role: 'sub_assistance' },

                    { role: 'manager' },

                    { role: 'ob_manager' }

                ]

            };

        } else {

            query = { _id: requesterId };

        }



        const users = await User.find(query)

            .select('-password -resetOtp -otpExpiry')

            .sort({ createdAt: -1 });



        res.status(200).json({

            success: true,

            message: 'Users fetched successfully',

            count: users.length,

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



        if (isMdManager && normalizedRole !== 'manager' && normalizedRole !== 'assistant' && normalizedRole !== 'sub_assistance') {

            return res.status(403).json({

                success: false,

                message: 'MD Managers can only create manager, assistant or sub assistance users'

            });

        }



        if (isSbm && normalizedRole !== 'rm' && normalizedRole !== 'am') {

            return res.status(403).json({

                success: false,

                message: 'SBM can only create RM or AM users'

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



        if (isSbm && normalizedRole === 'am') {

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

            const canAssignUnderManager = await canManageUserByChain({ requesterRole, requesterId, targetUser: managerUser });

            if (!canAssignUnderManager) {

                return res.status(403).json({ success: false, message: 'Access denied.' });

            }

            computedManagerId = requestedManagerId;

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

            role: normalizedRole,

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



// Update User (Admin only)

exports.updateUser = async (req, res) => {

    try {

        const requesterRole = normalizeRole(req.user?.role);

        const requesterId = (req.user?.id || req.user?._id || '').toString();



        if (!isAdminLike(requesterRole) && !isHierarchyManager(requesterRole)) {

            return res.status(403).json({

                success: false,

                message: 'Access denied. Admin only.'

            });

        }



        const { id } = req.params;

        const target = await User.findById(id).select('role managerId').lean();

        const allowed = await canManageUserByChain({ requesterRole, requesterId, targetUser: target });

        if (!allowed) {

            return res.status(403).json({

                success: false,

                message: 'Access denied.'

            });

        }



        const updates = req.body;



        if (Object.prototype.hasOwnProperty.call(updates || {}, 'role')) {

            delete updates.role;

        }



        if (Object.prototype.hasOwnProperty.call(updates || {}, 'managerId')) {

            const targetRole = normalizeRole(target?.role);

            const nextManagerId = String((updates || {}).managerId || '').trim();



            if (!ROLE_PARENTS[targetRole]) {

                delete updates.managerId;

            } else if (!mongoose.Types.ObjectId.isValid(nextManagerId)) {

                delete updates.managerId;

            } else if (!isAdminLike(requesterRole) && nextManagerId !== requesterId) {

                delete updates.managerId;

            } else {

                const managerUser = await User.findById(nextManagerId).select('role managerId').lean();

                if (!managerUser) {

                    delete updates.managerId;

                } else if (!validateParentForRole({ childRole: targetRole, parentRole: managerUser.role })) {

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



        const userToDelete = await User.findById(id).select('email role managerId companyName').lean();



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



