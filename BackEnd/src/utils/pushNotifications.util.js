const DeviceToken = require('../model/DeviceToken.model');
const { getMessaging } = require('./firebaseAdmin.util');

const normalizeEmail = (email) => (email || '').toString().trim().toLowerCase();

const sendTaskAssignedPush = async ({ toEmail, task, assignedByName }) => {
  const emailKey = normalizeEmail(toEmail);
  if (!emailKey) return;

  const tokens = await DeviceToken.find({
    userEmail: emailKey,
    revoked: { $ne: true }
  })
    .select('token')
    .lean();

  const tokenList = (tokens || []).map((t) => (t?.token || '').toString().trim()).filter(Boolean);
  if (tokenList.length === 0) {
    console.log('[push] no tokens for userEmail:', emailKey);
    return;
  }

  const title = 'New task assigned';
  const body = `${task?.title || 'A task'} assigned by ${assignedByName || 'manager'}`;
  const url = '/login';

  const payload = {
    tokens: tokenList,
    data: {
      title,
      body,
      url,
      taskId: task?._id ? String(task._id) : ''
    }
  };

  const messaging = getMessaging();
  const resp = await messaging.sendEachForMulticast(payload);

  const successCount = Number(resp?.successCount || 0);
  const failureCount = Number(resp?.failureCount || 0);
  console.log('[push] sent multicast', {
    toEmail: emailKey,
    taskId: task?._id ? String(task._id) : '',
    tokens: tokenList.length,
    successCount,
    failureCount
  });

  const invalidTokens = [];
  (resp.responses || []).forEach((r, idx) => {
    if (r.success) return;
    const code = r.error?.code || '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
      invalidTokens.push(tokenList[idx]);
    }
  });

  if (invalidTokens.length > 0) {
    await DeviceToken.updateMany({ token: { $in: invalidTokens } }, { $set: { revoked: true, lastSeenAt: new Date() } });
  }
};

module.exports = {
  sendTaskAssignedPush
};
