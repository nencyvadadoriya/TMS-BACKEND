const PowerStarMonthly = require('../model/PowerStarMonthly.model');
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

const normalizeWeekArr = (v) => {
  const arr = Array.isArray(v) ? v : [];
  return [0, 0, 0, 0].map((_, i) => {
    const n = Number(arr[i]);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, n);
  });
};

const buildManagerRoster = async () => {
  const users = await User.find({ isDeleted: { $ne: true } })
    .select('name email role position avatar')
    .lean();

  return (users || [])
    .filter((u) => normalizeRoleKey(u?.role) === 'manager')
    .map((u) => ({
      userId: String(u?._id || u?.id || ''),
      name: normalizeText(u?.name || u?.email || ''),
      email: normalizeEmail(u?.email || ''),
      role: normalizeText(u?.role || ''),
      position: normalizeText(u?.position || ''),
      avatar: normalizeText(u?.avatar || ''),
      churn: [0, 0, 0, 0],
      liveAssign: [0, 0, 0, 0],
      hits: [0, 0, 0, 0],
      freeze: false
    }))
    .filter((r) => Boolean(r.userId) || Boolean(r.email));
};

const mergeSavedIntoRoster = (rosterRows, savedRows) => {
  const roster = Array.isArray(rosterRows) ? rosterRows : [];
  const saved = Array.isArray(savedRows) ? savedRows : [];

  const byUserId = new Map();
  const byEmail = new Map();

  console.log('MERGE - SAVED ROWS IN:', savedRows);

  saved.forEach((r) => {
    const uid = normalizeText(r?.userId);
    const em = normalizeEmail(r?.email);
    const payload = {
      churn: normalizeWeekArr(r?.churn),
      liveAssign: normalizeWeekArr(r?.liveAssign),
      hits: normalizeWeekArr(r?.hits),
      freeze: Boolean(r?.freeze ?? false)
    };
    console.log('MERGE - PAYLOAD FOR USER', uid || em, payload);
    if (uid) byUserId.set(uid, payload);
    if (em) byEmail.set(em, payload);
  });

  const result = roster.map((r) => {
    const uid = normalizeText(r?.userId);
    const em = normalizeEmail(r?.email);
    const match = (uid && byUserId.get(uid)) || (em && byEmail.get(em));
    if (!match) return r;
    // Important: preserve freeze from saved data, do not override with roster's freeze=false
    const merged = {
      ...r,
      ...match,
      freeze: match.freeze // always take freeze from saved data
    };
    console.log('MERGE - RESULT FOR', uid || em, merged);
    return merged;
  });

  console.log('MERGE - FINAL RESULT:', result);
  return result;
};

exports.getMonthly = async (req, res) => {
  try {
    const monthKey = safeMonthKey(req.query?.month);
    const companyName = normalizeText(req.query?.companyName || '');

    const rosterRows = await buildManagerRoster();
    const doc = await PowerStarMonthly.findOne({ monthKey, companyName }).lean();
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
      message: 'OK'
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to fetch power star monthly', error: e?.message || e });
  }
};

exports.saveMonthly = async (req, res) => {
  try {
    const monthKey = safeMonthKey(req.body?.monthKey);
    const companyName = normalizeText(req.body?.companyName || '');
    const rowsIn = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const updatedBy = req.user?.email ? String(req.user.email) : '';

    console.log('REQ BODY ROWS:', rowsIn);

    const rows = rowsIn.map((r) => ({
      userId: normalizeText(r.userId),
      email: normalizeEmail(r.email),
      churn: normalizeWeekArr(r.churn),
      liveAssign: normalizeWeekArr(r.liveAssign),
      hits: normalizeWeekArr(r.hits),
      freeze: Boolean(r?.freeze ?? false)
    }));

    console.log('PROCESSED ROWS TO SAVE:', rows);

    await PowerStarMonthly.findOneAndUpdate(
      { monthKey, companyName },
      {
        $set: { monthKey, companyName, rows, updatedAt: new Date(), updatedBy }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Return directly from DB without merging roster (to preserve freeze state)
    const doc = await PowerStarMonthly.findOne({ monthKey, companyName }).lean();
    const dbRows = doc?.rows || [];

    console.log('DB ROWS AFTER SAVE (NO MERGE):', dbRows);

    return res.json({
      success: true,
      data: {
        companyName,
        monthKey,
        rows: dbRows,
        updatedAt: doc?.updatedAt || null,
        updatedBy: doc?.updatedBy || ''
      },
      message: 'Saved'
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to save power star monthly', error: e?.message || e });
  }
};
