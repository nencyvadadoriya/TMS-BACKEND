let admin;

try {
  admin = require('firebase-admin');
} catch {
  admin = null;
}

const normalizeEnvValue = (v) => String(v || '').trim().replace(/^['"]|['"]$/g, '');
const normalizeBase64 = (v) => normalizeEnvValue(v).replace(/\s+/g, '');

const initFirebaseAdmin = () => {
  if (!admin) return null;
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
    console.log('[firebaseAdmin] No credentials found (FIREBASE_SERVICE_ACCOUNT_JSON/BASE64 missing)');
    return null;
  }

  try {
    admin.initializeApp({ credential });
    console.log('[firebaseAdmin] Firebase Admin initialized for project:', JSON.parse(normalizeEnvValue(rawJson || '{}')).project_id || 'unknown');
    return admin;
  } catch (initErr) {
    console.error('[firebaseAdmin] Initialization error:', initErr.message);
    return null;
  }
};

const getMessaging = () => {
  const app = initFirebaseAdmin();
  if (!app) return null;
  try {
    return app.messaging();
  } catch {
    return null;
  }
};

module.exports = {
  initFirebaseAdmin,
  getMessaging
};
