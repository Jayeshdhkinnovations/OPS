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
// own, since that would let anyone register as anyone.
//
// Returns TWO different ids, deliberately not just one:
//   - firebaseUid: Firebase's own internal user-record id. Only valid as
//     long as that record exists - it changes if the record is ever deleted
//     and the person signs in again. Needed only for deleteFirebaseUser().
//   - googleId: the underlying Google account's own stable id, read out of
//     the token's federated-identity claim rather than the top-level uid.
//     This is what stays constant across a delete+recreate of the Firebase
//     record, so it's the one this app actually stores and matches on.
export async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'idToken is required.');
  }
  try {
    const decoded = await getFirebaseAuth().verifyIdToken(idToken);
    if (!decoded.email) {
      throw new Error('Token has no email.');
    }
    const googleId = decoded.firebase?.identities?.['google.com']?.[0] || decoded.uid;
    return {
      firebaseUid: decoded.uid,
      googleId,
      email: String(decoded.email).toLowerCase(),
      name: decoded.name || decoded.email,
      emailVerified: !!decoded.email_verified,
    };
  } catch (err) {
    console.log('verifyGoogleIdToken failed:', err.message);
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'Could not verify Google sign-in.');
  }
}

// Removes Firebase's own copy of a sign-in record. Used only for the "not
// approved yet" cases (new signup, or checking status while pending) - an
// account nobody can actually use yet should not sit in the Firebase
// console's user list looking like a real one. Safe to call even if the
// record is already gone; never allowed to fail the caller's response over
// this, since it's tidying up, not part of the actual approval logic.
export async function deleteFirebaseUser(firebaseUid) {
  try {
    await getFirebaseAuth().deleteUser(firebaseUid);
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') {
      console.log('deleteFirebaseUser failed:', err.message);
    }
  }
}
