const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const { requireModulePermission } = require('../middleware/permission.middleware');
const {
    getRoles,
    createRole,
    updateRole,
    deleteRole,
    getModules,
    createModule,
    updateModule,
    deleteModule,
    getUserEffectivePermissions,
    setUserPermission,
    applyTemplateToUser,
    getMyEffectivePermissions,
} = require('../Controller/access.controller');

const router = express.Router();

router.get('/roles', authMiddleware, requireModulePermission('access_management'), getRoles);
router.post('/roles', authMiddleware, requireModulePermission('access_management'), createRole);
router.put('/roles/:key', authMiddleware, requireModulePermission('access_management'), updateRole);
router.delete('/roles/:key', authMiddleware, requireModulePermission('access_management'), deleteRole);

router.get('/modules', authMiddleware, requireModulePermission('access_management'), getModules);
router.post('/modules', authMiddleware, requireModulePermission('access_management'), createModule);
router.put('/modules/:moduleId', authMiddleware, requireModulePermission('access_management'), updateModule);
router.delete('/modules/:moduleId', authMiddleware, requireModulePermission('access_management'), deleteModule);

router.get('/users/:userId/permissions', authMiddleware, requireModulePermission('access_management'), getUserEffectivePermissions);
router.put('/users/:userId/permissions/:moduleId', authMiddleware, requireModulePermission('access_management'), setUserPermission);
router.post('/users/:userId/apply-template', authMiddleware, requireModulePermission('access_management'), applyTemplateToUser);

router.get('/me/permissions', authMiddleware, getMyEffectivePermissions);

module.exports = router;
