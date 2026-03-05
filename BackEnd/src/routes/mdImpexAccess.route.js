const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const mdImpexAccessController = require('../Controller/mdImpexAccess.controller');

// Get all roles with their emails
router.get('/roles', auth, requireRoles('md_manager'), mdImpexAccessController.getAllRoles);

// Get all MD Impex members
router.get('/members', auth, requireRoles('md_manager'), mdImpexAccessController.getAllMembers);

// Get emails by specific role
router.get('/roles/:role/emails', auth, requireRoles('md_manager'), mdImpexAccessController.getEmailsByRole);

// Create a new role
router.post('/roles', auth, requireRoles('md_manager'), mdImpexAccessController.createRole);

// Update role emails
router.patch('/roles/:id/emails', auth, requireRoles('md_manager'), mdImpexAccessController.updateRoleEmails);

// Delete a role
router.delete('/roles/:id', auth, requireRoles('md_manager'), mdImpexAccessController.deleteRole);

// Person-wise access routes
router.get('/person-access', auth, requireRoles('md_manager'), mdImpexAccessController.getAllPersonAccess);
router.post('/person-access', auth, requireRoles('md_manager'), mdImpexAccessController.createPersonAccess);
router.patch('/person-access/:id', auth, requireRoles('md_manager'), mdImpexAccessController.updatePersonAccess);
router.delete('/person-access/:id', auth, requireRoles('md_manager'), mdImpexAccessController.deletePersonAccess);

module.exports = router;
