const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    try {
        // Get token from header
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        
        // Add user to request
        const normalized = decoded && typeof decoded === 'object' ? { ...decoded } : decoded;
        if (normalized && typeof normalized === 'object') {
            if (normalized.id != null) normalized.id = String(normalized.id);
            if (normalized._id != null) normalized._id = String(normalized._id);
            if (normalized.userId != null) normalized.userId = String(normalized.userId);
        }
        req.user = normalized;
        
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};