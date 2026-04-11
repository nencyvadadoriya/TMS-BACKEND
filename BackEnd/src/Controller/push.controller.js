const DeviceToken = require('../model/DeviceToken.model');
const { getMessaging } = require('../utils/firebaseAdmin.util');

const normalizeText = (v) => (v || '').toString().trim();
const normalizeEmail = (v) => normalizeText(v).toLowerCase();

exports.registerDeviceToken = async (req, res) => {
  try {
    const token = normalizeText(req.body?.token);
    const deviceId = normalizeText(req.body?.deviceId);
    const platform = normalizeText(req.body?.platform) || 'web';
    const userAgent = normalizeText(req.body?.userAgent);
    const userEmail = normalizeEmail(req.body?.userEmail);

    if (!token || !deviceId) {
      return res.status(400).json({ success: false, message: 'token and deviceId are required' });
    }

    // Always store userEmail so push lookups by email always find this token
    const set = {
      deviceId,
      platform,
      userAgent,
      revoked: false,
      lastSeenAt: new Date()
    };

    if (userEmail) {
      set.userEmail = userEmail;
    }

    const setOnInsert = { userId: null };
    if (userEmail) {
      // Only set on insert if not already set — $set above handles updates
      setOnInsert.userEmail = userEmail;
    }

    const doc = await DeviceToken.findOneAndUpdate(
      { token },
      { $set: set, $setOnInsert: setOnInsert },
      { new: true, upsert: true }
    ).lean();

    console.log(`[push] registerDeviceToken: token registered for email=${userEmail || '(none)'}, deviceId=${deviceId}`);
    return res.status(200).json({ success: true, data: { id: doc?._id }, message: 'Device token registered' });
  } catch (e) {
    console.error('[push] registerDeviceToken error:', e?.message);
    return res.status(500).json({ success: false, message: e?.message || 'Failed to register device token' });
  }
};

exports.testPush = async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.user?.email);
    if (!userEmail) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const title = normalizeText(req.body?.title) || 'Test notification';
    const body = normalizeText(req.body?.body) || 'FCM test message';
    const url = normalizeText(req.body?.url) || '/';

    const tokens = await DeviceToken.find({
      userEmail,
      revoked: { $ne: true }
    })
      .select('token')
      .lean();

    const tokenList = (tokens || []).map((t) => normalizeText(t?.token)).filter(Boolean);
    if (tokenList.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No tokens found for user',
        data: { tokens: 0, successCount: 0, failureCount: 0 }
      });
    }

    const messaging = getMessaging();
    if (!messaging) {
      return res.status(503).json({ success: false, message: 'Firebase not configured' });
    }

    // Must include `notification` block — data-only messages are invisible on Android/iOS background
    const payload = {
      tokens: tokenList,
      notification: { title, body },
      android: { notification: { sound: 'default', channelId: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
      data: { title, body, url, kind: 'test' }
    };

    const resp = await messaging.sendEachForMulticast(payload);

    console.log('[push] testPush result:', {
      toEmail: userEmail,
      tokens: tokenList.length,
      successCount: resp?.successCount,
      failureCount: resp?.failureCount,
      errors: (resp?.responses || []).filter(r => !r.success).map(r => r.error?.code)
    });

    return res.status(200).json({
      success: true,
      message: 'Test push sent',
      data: {
        tokens: tokenList.length,
        successCount: Number(resp?.successCount || 0),
        failureCount: Number(resp?.failureCount || 0)
      }
    });
  } catch (e) {
    console.error('[push] testPush error:', e?.message);
    return res.status(500).json({ success: false, message: e?.message || 'Failed to send test push' });
  }
};

exports.linkDeviceToUser = async (req, res) => {
  try {
    const deviceId = normalizeText(req.body?.deviceId);
    const token = normalizeText(req.body?.token);

    const userId = req.user?.id || req.user?._id;
    const userEmail = normalizeText(req.user?.email).toLowerCase();

    if (!userId || !userEmail) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!deviceId && !token) {
      return res.status(400).json({ success: false, message: 'deviceId or token is required' });
    }

    // Match by token first (most specific), then fallback to deviceId
    const filter = token ? { token } : { deviceId };

    const result = await DeviceToken.updateMany(
      filter,
      {
        $set: {
          userId,
          userEmail,  // Always stamp email so push lookups by email work
          revoked: false,
          lastSeenAt: new Date()
        }
      }
    );

    console.log(`[push] linkDeviceToUser: linked ${result.modifiedCount} token(s) to ${userEmail}`);
    return res.status(200).json({ success: true, message: 'Device linked to user' });
  } catch (e) {
    console.error('[push] linkDeviceToUser error:', e?.message);
    return res.status(500).json({ success: false, message: e?.message || 'Failed to link device' });
  }
};
