const mongoose = require('mongoose');
const Company = require('../model/Company.model');
const User = require('../model/user.model');
const redisClient = require('../utils/redisClient');

const clearCompanyCache = async () => {
    try {
        if (redisClient && redisClient.status === 'ready') {
            await redisClient.del('global:companies');
            const keys = await redisClient.keys('user:*:allowedCompanies');
            if (keys.length > 0) await redisClient.del(keys);
        }
    } catch (e) {
        console.warn('[Redis] Company cache clear error:', e.message);
    }
};

const normalizeName = (v) => (v || '').toString().trim();

const formatCompany = (c) => ({
  ...c,
  id: c._id
});

exports.getCompanies = async (req, res) => {
  try {
    if (redisClient && redisClient.status === 'ready') {
      const cached = await redisClient.get('global:companies');
      if (cached) return res.status(200).json(JSON.parse(cached));
    }

    const companies = await Company.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean();
    const responseData = { success: true, data: companies.map(c => formatCompany(c)) };
    
    if (redisClient && redisClient.status === 'ready') {
      await redisClient.set('global:companies', JSON.stringify(responseData), 'EX', 86400); // Cache globally for 24h
    }

    res.status(200).json(responseData);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch companies' });
  }
};

exports.getAllowedCompanies = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const userId = (req.user?.id || req.user?._id || '').toString();
    const cacheKey = `user:${userId}:allowedCompanies`;

    if (redisClient && redisClient.status === 'ready') {
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.status(200).json(JSON.parse(cached));
    }

    const resolveAssignedCompanyIdsForUser = async (startUserId) => {
      if (!mongoose.Types.ObjectId.isValid(startUserId)) return [];

      let currentId = startUserId;
      for (let depth = 0; depth < 8; depth++) {
        const u = await User.findById(currentId)
          .select('assignedCompanyIds managerId role')
          .lean();
        if (!u) return [];

        const companyIds = Array.isArray(u?.assignedCompanyIds) ? u.assignedCompanyIds : [];
        if (companyIds.length > 0) return companyIds;

        const nextManagerId = (u?.managerId || '').toString();
        if (!mongoose.Types.ObjectId.isValid(nextManagerId)) return [];
        currentId = nextManagerId;
      }

      return [];
    };

    if (role === 'md_manager' || role === 'ob_manager' || role === 'manager' || role === 'assistant' || role === 'sbm') {
      const companyIds = await resolveAssignedCompanyIdsForUser(userId);
      if (companyIds.length === 0) {
        const emptyData = { success: true, data: [] };
        if (redisClient && redisClient.status === 'ready') await redisClient.set(cacheKey, JSON.stringify(emptyData), 'EX', 3600);
        return res.status(200).json(emptyData);
      }

      const companies = await Company.find({ _id: { $in: companyIds }, isDeleted: { $ne: true } })
        .sort({ name: 1 })
        .lean();

      const responseData = { success: true, data: companies.map(c => formatCompany(c)) };
      if (redisClient && redisClient.status === 'ready') await redisClient.set(cacheKey, JSON.stringify(responseData), 'EX', 3600);
      return res.status(200).json(responseData);
    }

    const companies = await Company.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean();
    const responseDataGlobal = { success: true, data: companies.map(c => formatCompany(c)) };
    if (redisClient && redisClient.status === 'ready') await redisClient.set(cacheKey, JSON.stringify(responseDataGlobal), 'EX', 3600);
    return res.status(200).json(responseDataGlobal);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch companies' });
  }
};

exports.getDeletedCompanies = async (req, res) => {
  try {
    const companies = await Company.find({ isDeleted: true }).sort({ name: 1 }).lean();
    res.status(200).json({ success: true, data: companies.map(c => formatCompany(c)) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch deleted companies' });
  }
};

// New method to get company history
exports.getCompanyHistory = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid company id' });
    }

    const company = await Company.findById(id).lean();
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const history = company.history || [];
    res.status(200).json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch company history' });
  }
};

exports.createCompany = async (req, res) => {
  try {
    const name = normalizeName(req.body?.name);
    if (!name) {
      return res.status(400).json({ success: false, message: 'Company name is required' });
    }

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const existing = await Company.findOne({ name });
    if (existing) {
      return res.status(200).json({ success: true, data: formatCompany(existing.toObject()) });
    }

    const created = await Company.create({
      name,
      createdBy: actorId,
      updatedBy: actorId,
      history: [{
        action: 'company_created',
        performedBy: actorId,
        userName: actor.name || actor.email || 'Unknown',
        userEmail: actor.email || '',
        userRole: actor.role || '',
        message: `Company "${name}" was created`,
        newValue: { name, createdBy: actorId },
        timestamp: new Date()
      }]
    });

    await clearCompanyCache();

    res.status(201).json({ success: true, data: formatCompany(created.toObject()) });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await Company.findOne({ name: normalizeName(req.body?.name) });
      if (existing) {
        return res.status(200).json({ success: true, data: formatCompany(existing.toObject()) });
      }
    }
    res.status(500).json({ success: false, message: 'Failed to create company' });
  }
};

exports.bulkUpsertCompanies = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.companies) ? req.body.companies : [];
    if (!items.length) {
      return res.status(400).json({ success: false, message: 'companies array is required' });
    }

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const results = [];

    for (const raw of items) {
      const name = normalizeName(raw?.name || raw);
      if (!name) continue;

      const doc = await Company.findOneAndUpdate(
        { name },
        { $set: { name, updatedBy: actorId }, $setOnInsert: { createdBy: actorId } },
        { new: true, upsert: true }
      );

      results.push({ clientId: raw?.clientId || raw?.id || '', ...formatCompany(doc.toObject()) });
    }

    await clearCompanyCache();

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to bulk upsert companies' });
  }
};

exports.updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid company id' });
    }

    const name = normalizeName(req.body?.name);
    if (!name) {
      return res.status(400).json({ success: false, message: 'Company name is required' });
    }

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const existingCompany = await Company.findById(id);
    if (!existingCompany) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const updated = await Company.findByIdAndUpdate(
      id,
      { 
        $set: { name, updatedBy: actorId },
        $push: {
          history: {
            action: 'company_updated',
            performedBy: actorId,
            userName: actor.name || actor.email || 'Unknown',
            userEmail: actor.email || '',
            userRole: actor.role || '',
            message: `Company name updated from "${existingCompany.name}" to "${name}"`,
            field: 'name',
            oldValue: { name: existingCompany.name },
            newValue: { name },
            timestamp: new Date()
          }
        }
      },
      { new: true }
    ).lean();

    await clearCompanyCache();

    res.status(200).json({ success: true, data: formatCompany(updated) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Company name already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to update company' });
  }
};

exports.deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid company id' });
    }

    const actor = req.user || {};
    const actorId = (actor.id || actor._id || '').toString();

    const existingCompany = await Company.findById(id);
    if (!existingCompany) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const deleted = await Company.findByIdAndUpdate(
      id,
      {
        $set: {
          isActive: false,
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: actorId
        },
        $push: {
          history: {
            action: 'company_deleted',
            performedBy: actorId,
            userName: actor.name || actor.email || 'Unknown',
            userEmail: actor.email || '',
            userRole: actor.role || '',
            message: `Company "${existingCompany.name}" was deleted`,
            oldValue: { name: existingCompany.name, isActive: existingCompany.isActive },
            newValue: { isDeleted: true, deletedAt: new Date() },
            timestamp: new Date()
          }
        }
      },
      { new: true }
    );

    await clearCompanyCache();

    res.status(200).json({ success: true, message: 'Company deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete company' });
  }
};
