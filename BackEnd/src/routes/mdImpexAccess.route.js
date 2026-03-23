const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const mdImpexAccessController = require('../Controller/mdImpexAccess.controller');

// Get all roles with their emails
router.get('/roles', auth, requireRoles('md_manager', 'admin'), mdImpexAccessController.getAllRoles);

// Get all MD Impex members (allow any authenticated user to read members for task assignment)
router.get('/members', auth, mdImpexAccessController.getAllMembers);

// Get emails by specific role
router.get('/roles/:role/emails', auth, requireRoles('md_manager', 'admin'), mdImpexAccessController.getEmailsByRole);

// Create a new role
router.post('/roles', auth, requireRoles('md_manager', 'admin'), mdImpexAccessController.createRole);

// Update role emails
router.patch('/roles/:id/emails', auth, requireRoles('md_manager', 'admin'), mdImpexAccessController.updateRoleEmails);

// Delete a role
router.delete('/roles/:id', auth, requireRoles('md_manager', 'admin'), mdImpexAccessController.deleteRole);

// Person-wise access routes
// Get all person-wise access records (allow any authenticated user to read access to determine assignees)
router.get('/person-access', auth, mdImpexAccessController.getAllPersonAccess);
router.post('/person-access', auth, requireRoles('md_manager', 'admin'), mdImpexAccessController.createPersonAccess);
router.patch('/person-access/:id', auth, requireRoles('md_manager', 'admin'), mdImpexAccessController.updatePersonAccess);
router.delete('/person-access/:id', auth, requireRoles('md_manager', 'admin'), mdImpexAccessController.deletePersonAccess);

module.exports = router;
