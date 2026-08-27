import { appName } from '../../../Utils.js';
import { baseTemplate, esc } from '../../emailTemplates.js';
import sendSystemMail from '../../parsefunction/sendSystemMail.js';

// Constants (adjust to your preference)
export const OTP_LENGTH = 6;
export const OTP_EXPIRES_MIN = 10; // OTP validity in minutes
export const RESEND_COOLDOWN_SEC = 30; // Cooldown between OTP sends
export const MAX_ATTEMPTS = 5; // Max allowed wrong attempts

export function generateOtp(len = OTP_LENGTH) {
  // 6-digit numeric OTP (000000–999999, padded)
  const n = Math.floor(Math.random() * Math.pow(10, len));
  return String(n).padStart(len, '0');
}

export async function sendDeleteOtpEmail(extUser, otp) {
  const codeBlock = `<div style="margin:22px 0;padding:16px 0;text-align:center;background:#F9FAFB;border-radius:8px;font:700 28px/1 -apple-system,'Segoe UI',Arial,sans-serif;color:#1A1A1A;letter-spacing:8px;">${esc(otp)}</div>`;
  const params = {
    extUserId: extUser.id,
    from: appName,
    recipient: extUser?.get('Email'),
    subject: 'OTP for Deletion account request',
    html: baseTemplate({
      heading: 'Your verification code',
      intro: 'Use this code to confirm your account deletion request.',
      bodyHtml: codeBlock,
      footnote: `This code expires in ${OTP_EXPIRES_MIN} minutes. If you didn't request this code, you can ignore this email.`,
    }),
  };
  return sendSystemMail({ params });
}

export function msUntil(nowMs, futureMs) {
  return Math.max(0, (futureMs || 0) - nowMs);
}
