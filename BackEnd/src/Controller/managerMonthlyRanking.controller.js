const mongoose = require('mongoose');

const User = require('../model/user.model');
const ManagerMonthlyRanking = require('../model/ManagerMonthlyRanking.model');

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

const calcPercent = ({ assign, achieved }) => {
  const a = toNumberSafe(assign);
  const b = toNumberSafe(achieved);
  if (a <= 0) return 0;
  const pct = (b / a) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, pct);
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

exports.getManagerMonthlyRanking = async (req, res) => {
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

    const doc = await ManagerMonthlyRanking.findOne({
      companyName: { $regex: rx },
      monthKey
    }).lean();

    const rowByUserId = new Map(
      (doc?.rows || []).map((r) => [String(r.userId), { assign: toNumberSafe(r.assign), achieved: toNumberSafe(r.achieved) }])
    );

    const rows = (managers || []).map((u) => {
      const key = String(u._id);
      const existing = rowByUserId.get(key) || { assign: 0, achieved: 0 };
      const percent = calcPercent(existing);
      return {
        userId: key,
        name: u.name || u.email || '',
        email: u.email || '',
        role: u.role || 'manager',
        position: u.position || '',
        avatar: u.avatar || '',
        assign: existing.assign,
        achieved: existing.achieved,
        percent,
        percentLabel: `${percent.toFixed(1)}%`
      };
    });

    rows.sort((a, b) => (b.percent - a.percent) || (b.achieved - a.achieved) || a.name.localeCompare(b.name));

    const totals = rows.reduce(
      (acc, r) => {
        acc.assign += toNumberSafe(r.assign);
        acc.achieved += toNumberSafe(r.achieved);
        return acc;
      },
      { assign: 0, achieved: 0 }
    );

    const totalPercent = calcPercent(totals);

    return res.status(200).json({
      success: true,
      data: {
        companyName,
        monthKey,
        rows,
        totals: {
          assign: totals.assign,
          achieved: totals.achieved,
          percent: totalPercent,
          percentLabel: `${totalPercent.toFixed(1)}%`
        },
        updatedAt: doc?.updatedAt || null,
        updatedBy: doc?.updatedBy || ''
      }
    });
  } catch (error) {
    console.error('Error fetching manager monthly ranking:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch manager monthly ranking' });
  }
};

exports.upsertManagerMonthlyRanking = async (req, res) => {
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

        const assign = Math.max(0, toNumberSafe(r?.assign));
        const achieved = Math.max(0, toNumberSafe(r?.achieved));

        return { userId, assign, achieved };
      })
      .filter(Boolean);

    const update = {
      companyName,
      monthKey,
      rows: cleanedRows,
      updatedBy: actorId
    };

    console.log('Upserting with query:', { companyName: companyName, monthKey });
    console.log('Update data:', update);

    const doc = await ManagerMonthlyRanking.findOneAndUpdate(
      { companyName: { $regex: new RegExp(`^${escapeRegex(companyName)}$`, 'i') }, monthKey },
      { $set: update, $setOnInsert: { createdBy: actorId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    console.log('Upsert result:', doc);

    return res.status(200).json({ success: true, data: { id: doc?._id, _id: doc?._id } });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Duplicate month entry' });
    }
    console.error('Error saving manager monthly ranking:', error);
    return res.status(500).json({ success: false, message: 'Failed to save manager monthly ranking' });
  }
};
