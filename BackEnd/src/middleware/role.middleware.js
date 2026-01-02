const requireRoles = (...roles) => {
  const allowed = roles.map(r => String(r || '').toLowerCase());

  return (req, res, next) => {
    const userRole = String(req.user?.role || '').toLowerCase();

    if (!allowed.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    return next();
  };
};

const requireAdminOrManager = requireRoles('admin', 'manager');

module.exports = {
  requireRoles,
  requireAdminOrManager
};