const { getIO, normalizeCompanyKey } = require('./socket');

function emitBrandUpserted(brand) {
    try {
        const io = getIO();

        const companyName = (brand && (brand.company || brand.companyName)) || '';
        const companyKey = normalizeCompanyKey(companyName);

        const payload = {
            type: 'brand:upserted',
            brandId: String(brand && (brand._id || brand.id || '')),
            brand,
        };

        if (companyKey) {
            io.to(`company:${companyKey}`).emit('brand:upserted', payload);
        }

        io.to('role:admin-like').emit('brand:upserted', payload);
    } catch (error) {
        console.error('emitBrandUpserted error:', error && error.message ? error.message : error);
    }
}

function emitBrandDeleted({ brandId, companyName }) {
    try {
        const io = getIO();
        const companyKey = normalizeCompanyKey(companyName);

        const payload = {
            type: 'brand:deleted',
            brandId: String(brandId || ''),
            companyName: String(companyName || ''),
        };

        if (companyKey) {
            io.to(`company:${companyKey}`).emit('brand:deleted', payload);
        }

        io.to('role:admin-like').emit('brand:deleted', payload);
    } catch (error) {
        console.error('emitBrandDeleted error:', error && error.message ? error.message : error);
    }
}

module.exports = {
    emitBrandUpserted,
    emitBrandDeleted,
};
