const mongoose = require('mongoose');

const User = require('../model/user.model');
const PowerStarMonthly = require('../model/PowerStarMonthly.model');

const normalizeText = (v) => (v || '').toString().trim();

const escapeRegex = (value) => {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const normalizeMonthKey = (value) => {
  const raw = normalizeText(value);
  if (!raw) return '';
  const m = raw.match(/^\d{4}-\d{2}$/);
  return m ? raw : '';
};

const monthKeyNow = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const toNumberSafe = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n;
};

const clampWeekArray = (value) => {
  const arr = Array.isArray(value) ? value : [];
  const out = [0, 0, 0, 0].map((_, idx) => Math.max(0, toNumberSafe(arr[idx])));
  return out;
};

const resolveCompanyName = (req) => {
  const fromToken = normalizeText(req.user?.companyName || req.user?.company);
  return fromToken;
};

const resolveCompanyNameAsync = async (req) => {
  const fromToken = resolveCompanyName(req);
  if (fromToken) return fromToken;

  const email = normalizeText(req.user?.email).toLowerCase();
  const id = normalizeText(req.user?.id || req.user?._id || req.user?.userId);

  if (!email && !id) return '';

  const userDoc = await User.findOne(email ? { email } : { _id: id })
    .select('companyName company')
    .lean();

  return normalizeText(userDoc?.companyName || userDoc?.company);
};

exports.getPowerStarMonthly = async (req, res) => {
  try {
    const companyName = await resolveCompanyNameAsync(req);
    if (!companyName) {
      return res.status(400).json({ success: false, message: 'Company is required' });
    }

    const monthKey = normalizeMonthKey(req.query?.month) || monthKeyNow();
    const rx = new RegExp(`^${escapeRegex(companyName)}$`, 'i');

    const managers = await User.find({
      role: { $regex: /^manager$/i },
      companyName: { $regex: rx },
      isDeleted: { $ne: true }
    })
      .select('_id name email role position companyName avatar')
      .sort({ name: 1 })
      .lean();

    const doc = await PowerStarMonthly.findOne({
      companyName: { $regex: rx },
      monthKey
    }).lean();

    const rowByUserId = new Map(
      (doc?.rows || []).map((r) => [
        String(r.userId),
        {
          churn: clampWeekArray(r.churn),
          liveAssign: clampWeekArray(r.liveAssign),
          hits: clampWeekArray(r.hits)
        }
      ])
    );

    const rows = (managers || []).map((u) => {
      const key = String(u._id);
      const existing = rowByUserId.get(key) || {
        churn: [0, 0, 0, 0],
        liveAssign: [0, 0, 0, 0],
        hits: [0, 0, 0, 0]
      };

      return {
        userId: key,
        name: u.name || u.email || '',
        email: u.email || '',
        role: u.role || 'manager',
        position: u.position || '',
        avatar: u.avatar || '',
        churn: existing.churn,
        liveAssign: existing.liveAssign,
        hits: existing.hits
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        companyName,
        monthKey,
        rows,
        updatedAt: doc?.updatedAt || null,
        updatedBy: doc?.updatedBy || ''
      }
    });
  } catch (error) {
    console.error('Error fetching power star monthly:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch power star monthly' });
  }
};

exports.upsertPowerStarMonthly = async (req, res) => {
  try {
    const companyName = await resolveCompanyNameAsync(req);
    if (!companyName) {
      return res.status(400).json({ success: false, message: 'Company is required' });
    }

    const monthKey = normalizeMonthKey(req.body?.monthKey);
    if (!monthKey) {
      return res.status(400).json({ success: false, message: 'Valid monthKey (YYYY-MM) is required' });
    }

    const actorId = String(req.user?.id || req.user?._id || '').trim();
    const rowsInput = Array.isArray(req.body?.rows) ? req.body.rows : [];

    const rx = new RegExp(`^${escapeRegex(companyName)}$`, 'i');

    const managers = await User.find({
      role: { $regex: /^manager$/i },
      companyName: { $regex: rx },
      isDeleted: { $ne: true }
    })
      .select('_id')
      .lean();

    const allowedManagerIds = new Set((managers || []).map((u) => String(u._id)));

    const cleanedRows = rowsInput
      .map((r) => {
        const userId = String(r?.userId || r?._id || '').trim();
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;
        if (!allowedManagerIds.has(userId)) return null;

        return {
          userId,
          churn: clampWeekArray(r?.churn),
          liveAssign: clampWeekArray(r?.liveAssign),
          hits: clampWeekArray(r?.hits)
        };
      })
      .filter(Boolean);

    const update = {
      companyName,
      monthKey,
      rows: cleanedRows,
      updatedBy: actorId
    };

    const doc = await PowerStarMonthly.findOneAndUpdate(
      { companyName: { $regex: new RegExp(`^${escapeRegex(companyName)}$`, 'i') }, monthKey },
      { $set: update, $setOnInsert: { createdBy: actorId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.status(200).json({ success: true, data: { id: doc?._id, _id: doc?._id } });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Duplicate month entry' });
    }
    console.error('Error saving power star monthly:', error);
    return res.status(500).json({ success: false, message: 'Failed to save power star monthly' });
  }
};
