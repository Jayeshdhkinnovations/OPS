import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { normalizeEmail } from './SigningSecurity.js';

export const OTP_MAX_ATTEMPTS = 5;
export const OTP_TTL_MS = 10 * 60 * 1000;

function otpPepper() {
  const pepper = process.env.OTP_PEPPER || process.env.MASTER_KEY;
  if (!pepper) {
    throw new Parse.Error(
      Parse.Error.INTERNAL_SERVER_ERROR,
      'OTP security is not configured. Set OTP_PEPPER.'
    );
  }
  return pepper;
}

export function hashOtp({ code, salt, email, docId, contactId }) {
  return createHash('sha256')
    .update(
      [otpPepper(), salt, normalizeEmail(email), docId || '', contactId || '', String(code)].join(
        '\u0000'
      )
    )
    .digest('hex');
}

export function createOtpChallenge({ email, docId, contactId, now = new Date() }) {
  const code = String(randomInt(100000, 1000000));
  const salt = randomBytes(16).toString('hex');
  return {
    code,
    salt,
    hash: hashOtp({ code, salt, email, docId, contactId }),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
  };
}

export function verifyOtpChallenge({ storedHash, code, salt, email, docId, contactId }) {
  if (!storedHash || !salt || !code) return false;
  const candidate = hashOtp({ code, salt, email, docId, contactId });
  const expectedBuffer = Buffer.from(storedHash, 'hex');
  const candidateBuffer = Buffer.from(candidate, 'hex');
  return (
    expectedBuffer.length === candidateBuffer.length &&
    timingSafeEqual(expectedBuffer, candidateBuffer)
  );
}

export function hashSessionToken(sessionToken) {
  if (!sessionToken) return '';
  return createHash('sha256')
    .update([otpPepper(), String(sessionToken)].join('\u0000'))
    .digest('hex');
}
