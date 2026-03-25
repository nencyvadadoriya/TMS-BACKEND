/**
 * Get pagination parameters from request query
 * @param {Object} query req.query
 * @param {Object} options defaults and config
 * @returns {Object} { page, limit, skip }
 */
exports.getPaginationParams = (query, options = {}) => {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);

  const defaultLimit = options.defaultLimit || 1000000;
  const maxLimit = options.maxLimit || 1000000;

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), maxLimit) : defaultLimit;

  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

/**
 * Format pagination response
 * @param {Array} data The paginated data
 * @param {Number} total Total count of records
 * @param {Object} params { page, limit }
 * @returns {Object} Combined success object
 */
exports.formatPaginatedResponse = (data, total, { page, limit }) => {
  return {
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    }
  };
};
