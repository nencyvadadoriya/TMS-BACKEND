const requireRoles = (...roles) => {
  const allowedSet = new Set();
  roles
    .map(r => String(r || '').toLowerCase())
    .filter(Boolean)
    .forEach((r) => {
      allowedSet.add(r);
      if (r === 'admin') allowedSet.add('super_admin');
      if (r === 'manager') allowedSet.add('md_manager');
    });

  const allowed = Array.from(allowedSet);

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