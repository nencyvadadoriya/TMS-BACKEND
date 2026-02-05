const admin = require('firebase-admin');

const normalizeEnvValue = (v) => String(v || '').trim().replace(/^['"]|['"]$/g, '');
const normalizeBase64 = (v) => normalizeEnvValue(v).replace(/\s+/g, '');

const initFirebaseAdmin = () => {
  if (admin.apps && admin.apps.length > 0) return admin;

  const rawBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  let credential = null;
  try {
    if (rawBase64) {
      const normalized = normalizeEnvValue(rawBase64);
      if (normalized.startsWith('{')) {
        credential = admin.credential.cert(JSON.parse(normalized));
      } else {
        const decoded = Buffer.from(normalizeBase64(rawBase64), 'base64').toString('utf8');
        credential = admin.credential.cert(JSON.parse(decoded));
      }
    } else if (rawJson) {
      credential = admin.credential.cert(JSON.parse(normalizeEnvValue(rawJson)));
    }
  } catch (e) {
    throw new Error(`Failed to parse Firebase service account: ${e?.message || e}`);
  }

  if (!credential) {
    throw new Error('Firebase service account is not configured (set FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_SERVICE_ACCOUNT_JSON)');
  }

  admin.initializeApp({ credential });
  return admin;
};

const getMessaging = () => {
  const app = initFirebaseAdmin();
  return app.messaging();
};

module.exports = {
  initFirebaseAdmin,
  getMessaging
};
