const DeviceToken = require('../model/DeviceToken.model');
const { getMessaging } = require('./firebaseAdmin.util');

const normalizeEmail = (email) => (email || '').toString().trim().toLowerCase();

const normalizeText = (v) => (v == null ? '' : String(v)).trim();

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
  if (!messaging) {
    console.log('[push] skipped (firebase not configured) for userEmail:', emailKey);
    return;
  }
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

const sendChatMessagePush = async ({ toUserId, fromName, messageText, senderId }) => {
  const uid = normalizeText(toUserId);
  if (!uid) return;

  const tokens = await DeviceToken.find({
    userId: uid,
    revoked: { $ne: true }
  })
    .select('token')
    .lean();

  const tokenList = (tokens || []).map((t) => (t?.token || '').toString().trim()).filter(Boolean);
  if (tokenList.length === 0) {
    console.log('[push] no tokens for userId:', uid);
    return;
  }

  const title = normalizeText(fromName) ? `Message from ${normalizeText(fromName)}` : 'New message';
  const body = normalizeText(messageText) || 'You have a new message';
  const url = '/';

  const payload = {
    tokens: tokenList,
    notification: {
      title,
      body
    },
    data: {
      title,
      body,
      url,
      kind: 'chat_message',
      senderId: normalizeText(senderId)
    }
  };

  const messaging = getMessaging();
  if (!messaging) {
    console.log('[push] skipped (firebase not configured) for userId:', uid);
    return;
  }

  const resp = await messaging.sendEachForMulticast(payload);

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

const sendTaskReminderPush = async ({ toEmail, task, fromName, reminderMessage }) => {
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

  const title = 'Task reminder';
  const who = normalizeText(fromName) || 'Someone';
  const taskTitle = normalizeText(task?.title) || 'a task';
  const msg = normalizeText(reminderMessage);
  const body = msg ? `${who}: ${msg}` : `${taskTitle} (reminder from ${who})`;
  const url = '/login';

  const payload = {
    tokens: tokenList,
    data: {
      title,
      body,
      url,
      kind: 'task_reminder',
      taskId: task?._id ? String(task._id) : ''
    }
  };

  const messaging = getMessaging();
  if (!messaging) {
    console.log('[push] skipped (firebase not configured) for userEmail:', emailKey);
    return;
  }

  const resp = await messaging.sendEachForMulticast(payload);

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
  sendTaskAssignedPush,
  sendTaskReminderPush,
  sendChatMessagePush
};
