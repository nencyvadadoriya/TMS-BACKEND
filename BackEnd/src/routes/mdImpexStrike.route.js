const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');
const strikeController = require('../Controller/mdImpexStrike.controller');

// View strikes: All MD-Impex employees (assuming 'employee', 'manager', 'admin', 'md_manager', 'ob_manager')
router.get('/', auth, strikeController.getStrikes);

// Add, Edit, Delete: md_manager, ob_manager (and admin for safety)
router.post('/', auth, requireRoles('md_manager', 'ob_manager', 'admin'), strikeController.createStrike);
router.put('/:id', auth, requireRoles('md_manager', 'ob_manager', 'admin'), strikeController.updateStrike);
router.delete('/:id', auth, requireRoles('md_manager', 'ob_manager', 'admin'), strikeController.deleteStrike);

module.exports = router;
