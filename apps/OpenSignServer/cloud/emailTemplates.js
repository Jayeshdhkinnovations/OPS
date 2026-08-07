// Every transactional email the platform sends is built from the one layout
// below, so brand changes happen in a single place instead of being copied
// into each call site. Deliberately not the shared `appName` constant from
// Utils.js (that's "OpenSign™" and feeds the document-signing emails) - these
// are the Sign Toowix platform notifications.
//
// Constraints these templates are written to, which explain the otherwise
// odd choices: Outlook ignores <style> blocks and flexbox, so everything is
// inline styles on nested tables; Gmail strips <head>, so no CSS classes;
// and background gradients silently fall back to the solid `background`
// colour declared before them, so both are always set.
export const BRAND_NAME = 'Sign Toowix';
export const BRAND_TAGLINE = 'Secure Digital Document Platform';

const NAVY = '#002864';
const NAVY_LIGHT = '#1B4F91';
const INK = '#1A1A1A';
const MUTED = '#6B7280';
const FAINT = '#9AA5B4';
const HAIRLINE = '#EEF2F9';

// Accent colours per email tone. Success/security/warning share the layout
// and differ only in the icon puck, so a reader can tell at a glance whether
// something routine or something that needs attention just happened.
const TONES = {
  brand: { bg: '#EAF1FF', fg: NAVY },
  success: { bg: '#E7F7EF', fg: '#0F7B4F' },
  warning: { bg: '#FFF4E5', fg: '#B26A00' },
  danger: { bg: '#FDECEC', fg: '#C0392B' },
};

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Rows of label/value detail (IP, time, device...). Rendered as a table
// rather than a <dl> because Outlook collapses definition-list margins.
function detailRows(details = []) {
  const rows = details
    .filter(d => d && d.value)
    .map(
      d => `
      <tr>
        <td style="padding:7px 0;font:400 12px/1.4 'Segoe UI',Arial,sans-serif;color:${FAINT};white-space:nowrap;vertical-align:top;">${esc(d.label)}</td>
        <td style="padding:7px 0 7px 16px;font:600 12px/1.4 'Segoe UI',Arial,sans-serif;color:${INK};text-align:right;">${esc(d.value)}</td>
      </tr>`
    )
    .join('');
  if (!rows) return '';
  return `
    <tr>
      <td style="padding:4px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;border:1px solid ${HAIRLINE};border-radius:12px;padding:6px 16px;">
          ${rows}
        </table>
      </td>
    </tr>`;
}

/**
 * The shared shell: navy header, optional icon puck, heading, body copy,
 * optional detail table, optional CTA button, optional footnote.
 */
export function baseTemplate({
  icon = '',
  tone = 'brand',
  heading,
  intro = '',
  bodyHtml = '',
  details = [],
  ctaLabel = '',
  ctaUrl = '',
  footnote = '',
}) {
  const t = TONES[tone] || TONES.brand;

  const iconBlock = icon
    ? `
    <tr>
      <td style="padding:32px 32px 0;text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td style="width:56px;height:56px;border-radius:28px;background:${t.bg};text-align:center;vertical-align:middle;font:400 26px/56px 'Segoe UI',Arial,sans-serif;color:${t.fg};">${icon}</td>
          </tr>
        </table>
      </td>
    </tr>`
    : '';

  const ctaBlock =
    ctaLabel && ctaUrl
      ? `
    <tr>
      <td style="padding:26px 32px 4px;text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td style="background:${NAVY};background:linear-gradient(135deg,${NAVY_LIGHT},${NAVY});border-radius:28px;">
              <a href="${esc(ctaUrl)}" style="display:inline-block;padding:14px 34px;font:700 14px/1 'Segoe UI',Arial,sans-serif;color:#FFFFFF;text-decoration:none;border-radius:28px;">${esc(ctaLabel)}</a>
            </td>
          </tr>
        </table>
        <div style="margin-top:14px;font:400 11px/1.5 'Segoe UI',Arial,sans-serif;color:${FAINT};word-break:break-all;">
          Or paste this link into your browser:<br/>
          <span style="color:${NAVY_LIGHT};">${esc(ctaUrl)}</span>
        </div>
      </td>
    </tr>`
      : '';

  return `
<div style="background:${HAIRLINE};padding:32px 16px;font-family:'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 12px 32px -12px rgba(0,40,100,0.25);">
    <tr>
      <td style="background:${NAVY};background:linear-gradient(135deg,${NAVY_LIGHT},${NAVY});padding:28px 32px;text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 10px;">
          <tr>
            <td style="width:36px;height:36px;border-radius:10px;background:#FFFFFF;text-align:center;vertical-align:middle;font:700 16px/36px 'Segoe UI',Arial,sans-serif;color:#0B3D73;">S</td>
          </tr>
        </table>
        <div style="color:#FFFFFF;font-size:18px;font-weight:700;letter-spacing:0.3px;">${BRAND_NAME}</div>
        <div style="color:rgba(255,255,255,0.75);font-size:11px;margin-top:2px;">${BRAND_TAGLINE}</div>
      </td>
    </tr>
    ${iconBlock}
    <tr>
      <td style="padding:${icon ? '18px' : '32px'} 32px 0;text-align:center;">
        <div style="color:${INK};font-size:19px;font-weight:700;line-height:1.35;">${esc(heading)}</div>
        ${intro ? `<div style="color:${MUTED};font-size:13px;line-height:1.6;margin-top:8px;">${intro}</div>` : ''}
      </td>
    </tr>
    ${bodyHtml ? `<tr><td style="padding:18px 32px 0;">${bodyHtml}</td></tr>` : ''}
    ${detailRows(details)}
    ${ctaBlock}
    <tr>
      <td style="padding:26px 32px 30px;text-align:center;">
        <div style="height:1px;background:${HAIRLINE};margin:0 0 16px;"></div>
        <div style="color:${FAINT};font-size:11px;line-height:1.6;">
          ${footnote || `This is an automated message from ${BRAND_NAME}. Please do not reply.`}
        </div>
      </td>
    </tr>
  </table>
</div>`.trim();
}

// Formats a timestamp for humans in IST, the operating timezone for these
// accounts - a bare ISO string in a security alert is hard to sanity-check
// against "was that me?", which is the entire point of the email.
export function formatWhen(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(date) + ' IST';
  } catch {
    return date.toUTCString();
  }
}

/* ------------------------------------------------------------------ *
 * Individual templates
 * ------------------------------------------------------------------ */

export function otpEmail(otp, { purposeLabel = 'continue' } = {}) {
  const digitCells = otp
    .split('')
    .map(
      d =>
        `<td style="width:38px;height:48px;border:1px solid #DCE6F6;border-radius:8px;background:#F4F8FF;font:700 22px/48px 'Segoe UI',Arial,sans-serif;color:${NAVY};text-align:center;">${d}</td>`
    )
    .join('<td style="width:8px;"></td>');

  return {
    subject: `${BRAND_NAME} — Your verification code`,
    text: `Your ${BRAND_NAME} verification code is ${otp}. It expires in 5 minutes. If you didn't request this, you can ignore this email.`,
    html: baseTemplate({
      heading: 'Your verification code',
      intro: `Enter this code to ${esc(purposeLabel)}. It expires in <strong style="color:${INK};">5 minutes</strong>.`,
      bodyHtml: `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>${digitCells}</tr>
        </table>`,
      footnote: `Didn't request this code? You can safely ignore this email — your account is still secure.`,
    }),
  };
}

export function loginAlertEmail({ name, email, when, ip, device }) {
  return {
    subject: `${BRAND_NAME} — New sign-in to your account`,
    text: `Hi ${name || 'there'}, your ${BRAND_NAME} account (${email}) was just signed in to on ${when}${ip ? ` from IP ${ip}` : ''}. If this wasn't you, reset your password immediately.`,
    html: baseTemplate({
      icon: '&#10003;',
      tone: 'success',
      heading: 'New sign-in to your account',
      intro: `Hi ${esc(name || 'there')}, we noticed a new sign-in to your ${BRAND_NAME} account.`,
      details: [
        { label: 'Account', value: email },
        { label: 'When', value: when },
        { label: 'IP address', value: ip },
        { label: 'Device', value: device },
      ],
      footnote: `If this was you, no action is needed. If you don't recognise this sign-in, reset your password right away and enable two-factor authentication.`,
    }),
  };
}

export function passwordResetEmail({ name, resetUrl }) {
  return {
    subject: `${BRAND_NAME} — Reset your password`,
    text: `Hi ${name || 'there'}, reset your ${BRAND_NAME} password using this link: ${resetUrl}. If you didn't request this, you can ignore this email.`,
    html: baseTemplate({
      icon: '&#128274;',
      tone: 'brand',
      heading: 'Reset your password',
      intro: `Hi ${esc(name || 'there')}, we received a request to reset the password for your ${BRAND_NAME} account. Click below to choose a new one.`,
      ctaLabel: 'Reset password',
      ctaUrl: resetUrl,
      footnote: `Didn't request a password reset? You can safely ignore this email — your password will stay the same.`,
    }),
  };
}

export function twoFactorEnabledEmail({ name, email, when }) {
  return {
    subject: `${BRAND_NAME} — Two-factor authentication enabled`,
    text: `Hi ${name || 'there'}, two-factor authentication was enabled on your ${BRAND_NAME} account (${email}) on ${when}. If this wasn't you, contact your administrator immediately.`,
    html: baseTemplate({
      icon: '&#128737;',
      tone: 'success',
      heading: 'Two-factor authentication is on',
      intro: `Hi ${esc(name || 'there')}, your ${BRAND_NAME} account is now protected with two-factor authentication. You'll be asked for a verification code each time you sign in.`,
      details: [
        { label: 'Account', value: email },
        { label: 'Enabled on', value: when },
      ],
      footnote: `If you didn't turn this on, contact your administrator immediately — someone else may have access to your account.`,
    }),
  };
}

export function twoFactorDisabledEmail({ name, email, when }) {
  return {
    subject: `${BRAND_NAME} — Two-factor authentication disabled`,
    text: `Hi ${name || 'there'}, two-factor authentication was disabled on your ${BRAND_NAME} account (${email}) on ${when}. If this wasn't you, reset your password immediately.`,
    html: baseTemplate({
      icon: '&#9888;',
      tone: 'warning',
      heading: 'Two-factor authentication is off',
      intro: `Hi ${esc(name || 'there')}, two-factor authentication has been turned off for your ${BRAND_NAME} account. Your account is now protected by your password alone.`,
      details: [
        { label: 'Account', value: email },
        { label: 'Disabled on', value: when },
      ],
      footnote: `Didn't do this? Reset your password immediately and turn two-factor authentication back on from your profile settings.`,
    }),
  };
}

export function approvalApprovedEmail({ name, companyName, loginUrl, email }) {
  return {
    subject: `${BRAND_NAME} — Your workspace is ready`,
    text: `Hi ${name || 'there'}, your ${BRAND_NAME} workspace for ${companyName} has been approved and is ready. Sign in at ${loginUrl} using ${email}.`,
    html: baseTemplate({
      icon: '&#127881;',
      tone: 'success',
      heading: 'Your workspace is ready',
      intro: `Hi ${esc(name || 'there')}, good news — your request has been approved and your ${BRAND_NAME} workspace is live.`,
      details: [
        { label: 'Workspace', value: companyName },
        { label: 'Sign in as', value: email },
      ],
      ctaLabel: 'Go to your workspace',
      ctaUrl: loginUrl,
      footnote: `Sign in with the password you chose when you registered. Forgot it? Use "Forgot Password" on the sign-in page.`,
    }),
  };
}

export function approvalRejectedEmail({ name, companyName, reason }) {
  return {
    subject: `${BRAND_NAME} — Update on your registration`,
    text: `Hi ${name || 'there'}, we're unable to approve the ${BRAND_NAME} workspace request for ${companyName} at this time.${reason ? ` Reason: ${reason}` : ''}`,
    html: baseTemplate({
      icon: '&#9888;',
      tone: 'danger',
      heading: 'We couldn’t approve this request',
      intro: `Hi ${esc(name || 'there')}, thanks for your interest in ${BRAND_NAME}. Unfortunately we're not able to approve the workspace request for <strong style="color:${INK};">${esc(companyName)}</strong> at this time.`,
      details: reason ? [{ label: 'Reason', value: reason }] : [],
      footnote: `If you believe this was a mistake, reply to the team that invited you or submit a new request with updated details.`,
    }),
  };
}

export function approvalReceivedEmail({ name, companyName }) {
  return {
    subject: `${BRAND_NAME} — We received your request`,
    text: `Hi ${name || 'there'}, we've received your ${BRAND_NAME} workspace request for ${companyName}. You'll get an email as soon as it's reviewed.`,
    html: baseTemplate({
      icon: '&#9203;',
      tone: 'brand',
      heading: 'We received your request',
      intro: `Hi ${esc(name || 'there')}, thanks for signing up. Your workspace request is now with our team for review — we'll email you the moment it's approved.`,
      details: [{ label: 'Workspace', value: companyName }],
      footnote: `Most requests are reviewed within one business day. No action is needed from you right now.`,
    }),
  };
}
