const express = require('express');
const router = express.Router();
const brandController = require('../Controller/brand.controller');
const auth = require('../middleware/auth.middleware');
const { requireRoles, requireAdminOrManager } = require('../middleware/role.middleware');

// Get all brands (authenticated users)
router.get('/', auth, brandController.getBrands);

// Get deleted brands (admin only)
router.get('/admin/deleted', auth, requireRoles('admin'), brandController.getDeletedBrands);

// Get single brand (authenticated users)
router.get('/:id', auth, brandController.getBrandById);

// Create brand (admin or manager only)
router.post('/', auth, requireAdminOrManager, brandController.createBrand);

// Update brand (admin or manager only)
router.put('/:id', auth, requireAdminOrManager, brandController.updateBrand);

// Soft delete brand (admin or manager only)
router.delete('/:id', auth, requireAdminOrManager, brandController.softDeleteBrand);

// Restore deleted brand (admin only)
router.put('/:id/restore', auth, requireRoles('admin'), brandController.restoreBrand);

// Permanent delete (admin only)
router.delete('/:id/permanent', auth, requireRoles('admin'), brandController.hardDeleteBrand);

module.exports = router;