import crypto from 'node:crypto';
import sendSystemMail from './parsefunction/sendSystemMail.js';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_CLASS = 'contracts_TwoFactorOtp';
// Deliberately not the shared `appName` constant from Utils.js (that's
// "OpenSign™" and feeds every other email in the app) - this template is
// scoped to just the Sign Toowix brand, so it's a local literal instead of
// changing the app-wide constant and rippling into unrelated emails.
const BRAND_NAME = 'Sign Toowix';

function buildOtpEmailHtml(otp) {
  const digits = otp.split('');
  const digitCells = digits
    .map(
      (d) =>
        `<td style="width:38px;height:48px;border:1px solid #DCE6F6;border-radius:8px;background:#F4F8FF;font:700 22px/48px 'Segoe UI',Arial,sans-serif;color:#002864;text-align:center;">${d}</td>`
    )
    .join('<td style="width:8px;"></td>');

  return `
<div style="background:#EEF2F9;padding:32px 16px;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 12px 32px -12px rgba(0,40,100,0.25);">
    <tr>
      <td style="background:linear-gradient(135deg,#1B4F91,#002864);padding:28px 32px;text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 10px;">
          <tr>
            <td style="width:36px;height:36px;border-radius:10px;background:#FFFFFF;text-align:center;vertical-align:middle;font:700 16px/36px 'Segoe UI',Arial,sans-serif;color:#0B3D73;">S</td>
          </tr>
        </table>
        <div style="color:#FFFFFF;font-size:18px;font-weight:700;letter-spacing:0.3px;">${BRAND_NAME}</div>
        <div style="color:rgba(255,255,255,0.75);font-size:11px;margin-top:2px;">Secure Digital Document Platform</div>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 32px 8px;text-align:center;">
        <div style="color:#1A1A1A;font-size:17px;font-weight:700;">Your verification code</div>
        <div style="color:#6B7280;font-size:13px;margin-top:6px;">Enter this code to continue. It expires in 5 minutes.</div>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px 8px;text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>${digitCells}</tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 32px 32px;text-align:center;">
        <div style="height:1px;background:#EEF2F9;margin:0 0 16px;"></div>
        <div style="color:#9AA5B4;font-size:11px;line-height:1.5;">
          Didn't request this code? You can safely ignore this email - your account is still secure.
        </div>
      </td>
    </tr>
  </table>
</div>`.trim();
}

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

  await sendSystemMail({
    params: {
      from: BRAND_NAME,
      recipient: email,
      subject: `${BRAND_NAME} - Your verification code`,
      text: `Your ${BRAND_NAME} verification code is ${otp}. It expires in 5 minutes. If you didn't request this, you can ignore this email.`,
      html: buildOtpEmailHtml(otp),
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
