const express = require('express');
const {
    registerUser,
    loginUser,
    forgetPassword,
    verifyOtp,
    changePassword,
    getAllUsers,
    currentUser,
    createUser,
    deleteUser,
    updateUser,
    uploadProfileAvatar
} = require('../../Controller/user.controller');
const authMiddleware = require('../../middleware/auth.middleware');
const multer = require('multer');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const type = String(file?.mimetype || '').toLowerCase();
        if (type.startsWith('image/')) return cb(null, true);
        return cb(new Error('Only image files are allowed'));
    }
});

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/forgetPassword', forgetPassword);
router.post('/verifyOtp', verifyOtp);
router.post('/change-password', changePassword);
router.get('/getAllUsers', authMiddleware, getAllUsers);
router.get('/currentUser', authMiddleware, currentUser);

// Admin/Manager Routes
router.post('/createUser', authMiddleware, createUser);
router.delete('/deleteUser/:id', authMiddleware, deleteUser);
router.put('/updateUser/:id', authMiddleware, updateUser);

router.post('/profile/avatar', authMiddleware, upload.single('avatar'), uploadProfileAvatar);

module.exports = router;