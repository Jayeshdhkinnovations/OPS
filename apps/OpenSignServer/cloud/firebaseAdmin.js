// firebase-admin v14 is modular - the classic `admin.credential.cert(...)`
// namespace object is not how this version works. Subpath imports only.
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Lazily initialized rather than at import time, so a missing/misconfigured
// key produces a clean error from the one cloud function that needed it
// instead of crashing the whole server on boot.
let authInstance;
function getFirebaseAuth() {
  if (authInstance) return authInstance;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  }
  // Base64, not raw JSON: the key's newlines and quotes would not survive
  // being passed through `docker run -e` / an env file intact.
  const serviceAccount = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  const app = initializeApp({ credential: cert(serviceAccount) }, 'signtoowix-verify');
  authInstance = getAuth(app);
  return authInstance;
}

// Verifies a Firebase ID token was really issued by our Firebase project for
// a real Google sign-in - never trust an email/name the client claims on its
// own, since that would let anyone register as anyone. Returns the verified
// identity: a stable per-Google-account id (uid), plus email/name.
export async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'idToken is required.');
  }
  try {
    const decoded = await getFirebaseAuth().verifyIdToken(idToken);
    if (!decoded.email) {
      throw new Error('Token has no email.');
    }
    return {
      uid: decoded.uid,
      email: String(decoded.email).toLowerCase(),
      name: decoded.name || decoded.email,
      emailVerified: !!decoded.email_verified,
    };
  } catch (err) {
    console.log('verifyGoogleIdToken failed:', err.message);
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Could not verify Google sign-in.');
  }
}
