import crypto from 'node:crypto';
import sendSystemMail from './parsefunction/sendSystemMail.js';
import { BRAND_NAME, otpEmail } from './emailTemplates.js';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_CLASS = 'contracts_TwoFactorOtp';

function generateOtp() {
  // 6-digit, cryptographically random (not Math.random) - this one gates
  // real login access, not just an email-verification nice-to-have.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// `purpose` keeps a "setup" OTP (proving you own the inbox before turning
// 2FA on) from ever being reusable to satisfy a "login" OTP challenge, even
// if both happened to be requested around the same time for the same user.
export async function createAndSendOtp(extUser, purpose, extraFields = {}) {
  const email = extUser.get('Email');
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // One live OTP per (user, purpose) at a time - remove any stale one first.
  const existingQuery = new Parse.Query(OTP_CLASS);
  existingQuery.equalTo('ExtUserId', { __type: 'Pointer', className: 'contracts_Users', objectId: extUser.id });
  existingQuery.equalTo('Purpose', purpose);
  const existing = await existingQuery.find({ useMasterKey: true });
  if (existing.length) {
    await Parse.Object.destroyAll(existing, { useMasterKey: true });
  }

  const OtpClass = Parse.Object.extend(OTP_CLASS);
  const record = new OtpClass();
  record.set('ExtUserId', { __type: 'Pointer', className: 'contracts_Users', objectId: extUser.id });
  record.set('Email', email);
  record.set('OTP', otp);
  record.set('Purpose', purpose);
  record.set('ExpiresAt', expiresAt);
  for (const [key, value] of Object.entries(extraFields)) {
    record.set(key, value);
  }
  await record.save(null, { useMasterKey: true });

  const mail = otpEmail(otp, {
    purposeLabel: purpose === 'setup' ? 'turn on two-factor authentication' : 'finish signing in',
  });
  await sendSystemMail({
    params: {
      from: BRAND_NAME,
      recipient: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      extUserId: extUser.id,
    },
  });

  return record;
}

// Validates the code, and only on success deletes it (so a wrong guess
// doesn't burn the user's one real attempt) and returns the record - callers
// read any `extraFields` they stashed on it (e.g. a pending session token)
// off the returned object.
export async function verifyOtp(extUserId, purpose, otp) {
  const query = new Parse.Query(OTP_CLASS);
  query.equalTo('ExtUserId', { __type: 'Pointer', className: 'contracts_Users', objectId: extUserId });
  query.equalTo('Purpose', purpose);
  const record = await query.first({ useMasterKey: true });

  if (!record) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'No pending verification code. Please request a new one.');
  }
  if (record.get('ExpiresAt') < new Date()) {
    await record.destroy({ useMasterKey: true });
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'This code has expired. Please request a new one.');
  }
  if (record.get('OTP') !== otp) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Incorrect code.');
  }

  await record.destroy({ useMasterKey: true });
  return record;
}
