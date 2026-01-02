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
    updateUser
} = require('../../Controller/user.controller');
const authMiddleware = require('../../middleware/auth.middleware');

const router = express.Router();

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

module.exports = router;