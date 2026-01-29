const express = require('express');
const router = express.Router();
const brandController = require('../Controller/brand.controller');
const auth = require('../middleware/auth.middleware');
const { requireModulePermission, requireAnyModulePermission } = require('../middleware/permission.middleware');

// Get all brands (authenticated users)
router.get(
    '/',
    auth,
    requireAnyModulePermission(['brands_page', 'task_brand_assignment', 'create_task', 'assign_task']),
    brandController.getBrands
);

// Get brands assigned to user for task creation
router.get(
    '/assigned',
    auth,
    requireAnyModulePermission(['task_brand_assignment', 'create_task', 'assign_task', 'brands_page']),
    brandController.getAssignedBrands
);

// Get deleted brands (permission based)
router.get('/admin/deleted', auth, requireModulePermission('brand_delete'), brandController.getDeletedBrands);

// Get single brand (authenticated users)
router.get(
    '/:id',
    auth,
    requireAnyModulePermission(['brands_page', 'task_brand_assignment', 'create_task', 'assign_task']),
    brandController.getBrandById
);

// Create brand (permission based)
router.post('/', auth, requireModulePermission('brand_create'), brandController.createBrand);

// Bulk upsert brands (permission based)
router.post('/bulk', auth, requireModulePermission('brand_bulk_add'), brandController.bulkUpsertBrands);

// Update brand (permission based)
router.put('/:id', auth, requireModulePermission('brand_edit'), brandController.updateBrand);

// Soft delete brand (permission based)
router.delete('/:id', auth, requireModulePermission('brand_delete'), brandController.softDeleteBrand);

// Restore deleted brand (permission based)
router.put('/:id/restore', auth, requireModulePermission('brand_delete'), brandController.restoreBrand);

// Permanent delete (permission based)
router.delete('/:id/permanent', auth, requireModulePermission('brand_delete'), brandController.hardDeleteBrand);

module.exports = router;