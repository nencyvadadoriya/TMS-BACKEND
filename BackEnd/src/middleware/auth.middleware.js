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
        req.user = decoded;
        
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};