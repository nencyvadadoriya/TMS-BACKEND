const ManagerMonthlyRanking = require('../model/ManagerMonthlyRanking.model');
const User = require('../model/user.model');

const normalizeText = (v) => (v == null ? '' : String(v)).trim();
const monthKeyRegex = /^\d{4}-\d{2}$/;

const safeMonthKey = (raw) => {
  const v = normalizeText(raw);
  if (monthKeyRegex.test(v)) return v;
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
};

const normalizeRoleKey = (v) => normalizeText(v).toLowerCase().replace(/[\s-]+/g, '_');

const normalizeEmail = (v) => normalizeText(v).toLowerCase();

const clampNonNegativeInt = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
};

const buildManagerRoster = async () => {
  const users = await User.find({ isDeleted: { $ne: true } })
    .select('name email role position avatar')
    .lean();

  return (users || [])
    .filter((u) => ['manager', 'marketer_manager'].includes(normalizeRoleKey(u?.role)))
    .map((u) => ({
      userId: String(u?._id || u?.id || ''),
      name: normalizeText(u?.name || u?.email || ''),
      email: normalizeEmail(u?.email || ''),
      role: normalizeText(u?.role || ''),
      position: normalizeText(u?.position || ''),
      avatar: normalizeText(u?.avatar || ''),
      assign: 0,
      achieved: 0
    }))
    .filter((r) => Boolean(r.userId) || Boolean(r.email));
};

const mergeSavedIntoRoster = (rosterRows, savedRows) => {
  const roster = Array.isArray(rosterRows) ? rosterRows : [];
  const saved = Array.isArray(savedRows) ? savedRows : [];

  const savedByUserId = new Map();
  const savedByEmail = new Map();

  saved.forEach((r) => {
    const uid = normalizeText(r?.userId);
    const em = normalizeEmail(r?.email);
    const payload = {
      assign: clampNonNegativeInt(r?.assign),
      achieved: clampNonNegativeInt(r?.achieved)
    };
    if (uid) savedByUserId.set(uid, payload);
    if (em) savedByEmail.set(em, payload);
  });

  return roster.map((r) => {
    const uid = normalizeText(r?.userId);
    const em = normalizeEmail(r?.email);
    const match = (uid && savedByUserId.get(uid)) || (em && savedByEmail.get(em));
    if (!match) return r;
    const assign = match.assign;
    const achieved = Math.min(match.achieved, assign);
    return { ...r, assign, achieved };
  });
};

exports.getMonthlyRanking = async (req, res) => {
  try {
    const monthKey = safeMonthKey(req.query?.month);

    // default companyName blank; frontend doesn't filter by company today
    const companyName = normalizeText(req.query?.companyName || '');

    const rosterRows = await buildManagerRoster();

    const doc = await ManagerMonthlyRanking.findOne({ monthKey, companyName }).lean();
    const mergedRows = mergeSavedIntoRoster(rosterRows, doc?.rows);

    const payload = {
      companyName,
      monthKey,
      rows: mergedRows,
      updatedAt: doc?.updatedAt || null,
      updatedBy: doc?.updatedBy || ''
    };

    return res.json({ success: true, data: payload, message: 'OK' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to fetch monthly ranking', error: e?.message || e });
  }
};

exports.saveMonthlyRanking = async (req, res) => {
  try {
    const monthKey = safeMonthKey(req.body?.monthKey);
    const companyName = normalizeText(req.body?.companyName || '');
    const rowsIn = Array.isArray(req.body?.rows) ? req.body.rows : [];

    const updatedBy = req.user?.email ? String(req.user.email) : '';

    const rows = rowsIn.map((r) => ({
      userId: normalizeText(r.userId),
      email: normalizeEmail(r.email),
      assign: clampNonNegativeInt(r.assign),
      achieved: clampNonNegativeInt(r.achieved)
    }));

    await ManagerMonthlyRanking.findOneAndUpdate(
      { monthKey, companyName },
      {
        $set: {
          monthKey,
          companyName,
          rows,
          updatedAt: new Date(),
          updatedBy
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Return enriched data to frontend.
    const rosterRows = await buildManagerRoster();
    const doc = await ManagerMonthlyRanking.findOne({ monthKey, companyName }).lean();
    const mergedRows = mergeSavedIntoRoster(rosterRows, doc?.rows);

    return res.json({
      success: true,
      data: {
        companyName,
        monthKey,
        rows: mergedRows,
        updatedAt: doc?.updatedAt || null,
        updatedBy: doc?.updatedBy || ''
      },
      message: 'Saved'
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to save monthly ranking', error: e?.message || e });
  }
};
