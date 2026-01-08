const mongoose = require('mongoose');
const Company = require('../model/Company.model');

const normalizeName = (v) => (v || '').toString().trim();

const formatCompany = (c) => ({
  ...c,
  id: c._id
});

exports.getCompanies = async (req, res) => {
  try {
    const companies = await Company.find({ isDeleted: { $ne: true } }).sort({ name: 1 }).lean();
    res.status(200).json({ success: true, data: companies.map(c => formatCompany(c)) });
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch companies' });
  }
};

exports.getDeletedCompanies = async (req, res) => {
  try {
    const companies = await Company.find({ isDeleted: true }).sort({ name: 1 }).lean();
    res.status(200).json({ success: true, data: companies.map(c => formatCompany(c)) });
  } catch (error) {
    console.error('Error fetching deleted companies:', error);
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
    console.error('Error fetching company history:', error);
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

    res.status(201).json({ success: true, data: formatCompany(created.toObject()) });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await Company.findOne({ name: normalizeName(req.body?.name) });
      if (existing) {
        return res.status(200).json({ success: true, data: formatCompany(existing.toObject()) });
      }
    }

    console.error('Error creating company:', error);
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

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error('Error bulk upserting companies:', error);
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

    res.status(200).json({ success: true, data: formatCompany(updated) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Company name already exists' });
    }

    console.error('Error updating company:', error);
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

    res.status(200).json({ success: true, message: 'Company deleted successfully' });
  } catch (error) {
    console.error('Error deleting company:', error);
    res.status(500).json({ success: false, message: 'Failed to delete company' });
  }
};
