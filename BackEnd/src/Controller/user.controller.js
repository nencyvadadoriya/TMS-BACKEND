const User = require('../model/user.model');
const bcrypt = require('bcrypt');
const jwt = require("jsonwebtoken");


const Task = require('../model/Task.model');
const TaskHistory = require('../model/TaskHistory.model');
const Brand = require('../model/Brand.model');
const { sendOtpEmail, sendAccountCreatedEmail } = require('../middleware/email.message');
const { _getEffectivePermissionsMap } = require('./access.controller');

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
        const { email, password } = req.body;
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
        const requesterRole = String(req.user?.role || '').toLowerCase();
        const requesterId = (req.user?.id || req.user?._id || '').toString();

        let query = {};

        if (requesterRole === 'admin') {
            query = {};
        } else if (requesterRole === 'manager') {
            query = {
                $or: [
                    { _id: requesterId },
                    { role: 'manager' },
                    { role: 'assistant', managerId: requesterId }
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
        const requesterRole = String(req.user?.role || '').toLowerCase();
        const requesterId = (req.user?.id || req.user?._id || '').toString();
        const isAdmin = requesterRole === 'admin';
        const isManager = requesterRole === 'manager';

        if (!isAdmin && !isManager) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.'
            });
        }

        const { name, email, password, role, phone, department, position } = req.body;

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

        const normalizedRole = String(role || 'assistant').toLowerCase();

        if (isManager && normalizedRole !== 'assistant') {
            return res.status(403).json({
                success: false,
                message: 'Managers can only create assistant users'
            });
        }

        const newUser = new User({
            name,
            email: safeEmail,
            password: hashedPassword,
            role: isAdmin ? (normalizedRole || 'assistant') : 'assistant',
            managerId: isManager ? requesterId : null,
            // If a manager creates an assistant, only assign what the manager explicitly selects
            assignedBrandIds: (req.body?.assignedBrandIds || []),
            phone: phone || '',
            department: department || '',
            position: position || '',
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
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        const { id } = req.params;
        const updates = req.body;

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
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        const { id } = req.params;

        // Prevent admin from deleting themselves
        if (id === req.user.id) {
            return res.status(400).json({
                success: false,
                message: 'You cannot delete yourself'
            });
        }

        const userToDelete = await User.findById(id).select('email role').lean();

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

