// Every transactional email the platform sends is built from the one layout
// below, so brand changes happen in a single place instead of being copied
// into each call site. Deliberately not the shared `appName` constant from
// Utils.js (that's "OpenSign™" and feeds the document-signing emails) - these
// are the SignToowix platform notifications.
//
// Design intent: plain and editorial, not a gradient-heavy "template
// generator" look. One accent colour (navy), used only for the button and
// links. Everything else is black/gray text on a white card - the kind of
// email a person would actually write, not a marketing banner.
//
// Constraints these templates are written to: Outlook ignores <style> blocks
// and flexbox, so layout is inline-styled tables; Gmail strips <head>, so
// dark-mode support below relies on inline styles plus a small guarded
// <style> block that the clients which DO support it (Apple Mail, iOS Mail,
// Outlook.com, some Gmail) will honour and the rest will simply ignore.
export const BRAND_NAME = 'SignToowix';
export const BRAND_TAGLINE = 'Secure Digital Document Platform';

const NAVY = '#1B4F91';
const INK = '#1A1A1A';
const MUTED = '#6B7280';
const FAINT = '#9CA3AF';
const HAIRLINE = '#E5E7EB';

// Public URL only - email clients cannot load local files or data URIs.
const LOGO_URL = `${process.env.PUBLIC_ORIGIN || ''}/static/js/assets/images/email-logo.png`;
const LOGO_URL_DARK = `${process.env.PUBLIC_ORIGIN || ''}/static/js/assets/images/logo-dark.png`;

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Two stacked images, swapped by the same `.logo-light`/`.logo-dark` +
// prefers-color-scheme pattern already used in password_reset_email.html -
// the light mark for a light/unknown-theme inbox, the dark-mode mark once a
// client actually signals dark mode. Falls back to the light mark wherever
// prefers-color-scheme support is stripped, which just means the light logo
// on a dark background - never nothing.
const logoBlock = `<span style="display:inline-block;">
    <img src="${LOGO_URL}" width="87" height="32" alt="${BRAND_NAME}" class="logo-light" style="display:block;border:0;background:transparent;" />
    <img src="${LOGO_URL_DARK}" width="87" height="32" alt="${BRAND_NAME}" class="logo-dark" style="display:none;border:0;background:transparent;" />
  </span>`;

// Rows of label/value detail (device, time, location...). A plain table,
// not a card - matches the rest of the plain-text feel.
function detailRows(details = []) {
  const rows = details
    .filter(d => d && d.value)
    .map(
      d => `
      <tr>
        <td style="padding:5px 0;font:400 13px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;color:${FAINT};white-space:nowrap;vertical-align:top;">${esc(d.label)}</td>
        <td style="padding:5px 0 5px 20px;font:600 13px/1.5 -apple-system,'Segoe UI',Arial,sans-serif;color:${INK};text-align:right;">${esc(d.value)}</td>
      </tr>`
    )
    .join('');
  if (!rows) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">${rows}</table>`;
}

/**
 * The shared shell: small logo + wordmark, a heading, body copy, optional
 * detail rows, optional button, and a quiet footer. No gradients, no coloured
 * icon badges, no card-within-a-card - one flat white surface.
 */
export function baseTemplate({
  heading,
  intro = '',
  bodyHtml = '',
  details = [],
  ctaLabel = '',
  ctaUrl = '',
  footnote = '',
}) {
  const ctaBlock =
    ctaLabel && ctaUrl
      ? `
    <tr>
      <td style="padding:24px 0 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:${NAVY};border-radius:8px;">
              <a href="${esc(ctaUrl)}" style="display:inline-block;padding:12px 26px;font:600 14px/1 -apple-system,'Segoe UI',Arial,sans-serif;color:#FFFFFF;text-decoration:none;border-radius:8px;">${esc(ctaLabel)}</a>
            </td>
          </tr>
        </table>
        <div style="margin-top:14px;font:400 12px/1.6 -apple-system,'Segoe UI',Arial,sans-serif;color:${FAINT};word-break:break-all;">
          Or copy this link: <span style="color:${NAVY};">${esc(ctaUrl)}</span>
        </div>
      </td>
    </tr>`
      : '';

  return `
<meta name="color-scheme" content="light dark">
<meta name="supported-color-scheme" content="light dark">
<style>
  @media (prefers-color-scheme: dark) {
    .email-bg { background:#0B0F19 !important; }
    .email-card { background:#0B0F19 !important; }
    .email-ink { color:#F3F4F6 !important; }
    .email-muted { color:#9CA3AF !important; }
    .email-hairline { border-color:#232838 !important; }
    .logo-light { display:none !important; }
    .logo-dark { display:block !important; }
  }
  /* Gmail (web and app) doesn't reliably honour prefers-color-scheme on
     injected mail HTML - it instead stamps [data-ogsc] onto the message
     when its own dark mode is on. Same rules, repeated under that selector,
     is the standard workaround; every other client just ignores it. */
  [data-ogsc] .email-bg { background:#0B0F19 !important; }
  [data-ogsc] .email-card { background:#0B0F19 !important; }
  [data-ogsc] .email-ink { color:#F3F4F6 !important; }
  [data-ogsc] .email-muted { color:#9CA3AF !important; }
  [data-ogsc] .email-hairline { border-color:#232838 !important; }
  [data-ogsc] .logo-light { display:none !important; }
  [data-ogsc] .logo-dark { display:block !important; }
</style>
<div class="email-bg" style="background:#FFFFFF;padding:40px 20px;font-family:-apple-system,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;margin:0 auto;">
    <tr>
      <td class="email-card" style="background:#FFFFFF;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle;">${logoBlock}</td>
          </tr>
        </table>

        <div class="email-hairline" style="height:1px;background:${HAIRLINE};margin:22px 0 26px;"></div>

        <div class="email-ink" style="color:${INK};font-size:18px;font-weight:700;line-height:1.4;">${esc(heading)}</div>
        ${intro ? `<div class="email-muted" style="color:${MUTED};font-size:14px;line-height:1.65;margin-top:10px;">${intro}</div>` : ''}
        ${bodyHtml}
        ${detailRows(details)}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${ctaBlock}</table>

        <div class="email-hairline" style="height:1px;background:${HAIRLINE};margin:30px 0 16px;"></div>
        <div class="email-muted" style="color:${FAINT};font-size:12px;line-height:1.6;">
          ${footnote || `Sent by ${BRAND_NAME}. Please do not reply to this email.`}
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
    return (
      new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(date) + ' IST'
    );
  } catch {
    return date.toUTCString();
  }
}

/* ------------------------------------------------------------------ *
 * Individual templates
 * ------------------------------------------------------------------ */

export function otpEmail(otp, { purposeLabel = 'continue' } = {}) {
  const codeBlock = `<div style="margin:22px 0;padding:16px 0;text-align:center;background:#F9FAFB;border-radius:8px;font:700 28px/1 -apple-system,'Segoe UI',Arial,sans-serif;color:${INK};letter-spacing:8px;">${esc(otp)}</div>`;

  return {
    subject: `${BRAND_NAME} — Your verification code`,
    text: `Your ${BRAND_NAME} verification code is ${otp}. It expires in 5 minutes. If you didn't request this, you can ignore this email.`,
    html: baseTemplate({
      heading: 'Your verification code',
      intro: `Enter this code to ${esc(purposeLabel)}. It expires in 5 minutes.`,
      bodyHtml: codeBlock,
      footnote: `Didn't request this code? You can safely ignore this email — your account is still secure.`,
    }),
  };
}

export function loginAlertEmail({ name, email, when, location, device }) {
  return {
    subject: `${BRAND_NAME} — New sign-in to your account`,
    text: `Hi ${name || 'there'}, your ${BRAND_NAME} account (${email}) was just signed in to on ${when}${location ? ` from ${location}` : ''}. If this wasn't you, reset your password immediately.`,
    html: baseTemplate({
      heading: 'New sign-in to your account',
      intro: `Hi ${esc(name || 'there')}, we noticed a new sign-in to your account.`,
      details: [
        { label: 'When', value: when },
        { label: 'Location', value: location || 'Unknown' },
        { label: 'Device', value: device },
      ],
      footnote: `If this was you, no action is needed. If you don't recognise this sign-in, reset your password and enable two-factor authentication.`,
    }),
  };
}

export function passwordResetEmail({ name, resetUrl }) {
  return {
    subject: `${BRAND_NAME} — Reset your password`,
    text: `Hi ${name || 'there'}, reset your ${BRAND_NAME} password using this link: ${resetUrl}. If you didn't request this, you can ignore this email.`,
    html: baseTemplate({
      heading: 'Reset your password',
      intro: `Hi ${esc(name || 'there')}, we received a request to reset your password. Click below to choose a new one.`,
      ctaLabel: 'Reset password',
      ctaUrl: resetUrl,
      footnote: `Didn't request this? You can safely ignore this email — your password will stay the same.`,
    }),
  };
}

export function twoFactorEnabledEmail({ name, email, when }) {
  return {
    subject: `${BRAND_NAME} — Two-factor authentication enabled`,
    text: `Hi ${name || 'there'}, two-factor authentication was enabled on your ${BRAND_NAME} account (${email}) on ${when}. If this wasn't you, contact your administrator immediately.`,
    html: baseTemplate({
      heading: 'Two-factor authentication is on',
      intro: `Hi ${esc(name || 'there')}, your account now requires a verification code each time you sign in.`,
      details: [
        { label: 'Account', value: email },
        { label: 'Enabled on', value: when },
      ],
      footnote: `If you didn't turn this on, contact your administrator immediately.`,
    }),
  };
}

export function twoFactorDisabledEmail({ name, email, when }) {
  return {
    subject: `${BRAND_NAME} — Two-factor authentication disabled`,
    text: `Hi ${name || 'there'}, two-factor authentication was disabled on your ${BRAND_NAME} account (${email}) on ${when}. If this wasn't you, reset your password immediately.`,
    html: baseTemplate({
      heading: 'Two-factor authentication is off',
      intro: `Hi ${esc(name || 'there')}, your account is now protected by your password alone.`,
      details: [
        { label: 'Account', value: email },
        { label: 'Disabled on', value: when },
      ],
      footnote: `Didn't do this? Reset your password immediately and turn two-factor authentication back on.`,
    }),
  };
}

export function approvalApprovedEmail({ name, companyName, loginUrl, email }) {
  return {
    subject: `${BRAND_NAME} — Your workspace is ready`,
    text: `Hi ${name || 'there'}, your ${BRAND_NAME} workspace for ${companyName} has been approved and is ready. Sign in at ${loginUrl} using ${email}.`,
    html: baseTemplate({
      heading: 'Your workspace is ready',
      intro: `Hi ${esc(name || 'there')}, your request has been approved and your workspace is live.`,
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
      heading: 'We couldn’t approve this request',
      intro: `Hi ${esc(name || 'there')}, we're not able to approve the workspace request for <strong>${esc(companyName)}</strong> at this time.`,
      details: reason ? [{ label: 'Reason', value: reason }] : [],
      footnote: `If you believe this was a mistake, submit a new request with updated details.`,
    }),
  };
}

export function approvalReceivedEmail({ name, companyName }) {
  return {
    subject: `${BRAND_NAME} — We received your request`,
    text: `Hi ${name || 'there'}, we've received your ${BRAND_NAME} workspace request for ${companyName}. You'll get an email as soon as it's reviewed.`,
    html: baseTemplate({
      heading: 'We received your request',
      intro: `Hi ${esc(name || 'there')}, thanks for signing up. We'll email you the moment your workspace is approved.`,
      details: [{ label: 'Workspace', value: companyName }],
      footnote: `Most requests are reviewed within one business day.`,
    }),
  };
}

// Sent to the platform admin, not the registrant - the counterpart to
// approvalReceivedEmail above. Points at the Approval section of the
// console rather than assuming a specific URL the admin already has open.
export function newApprovalRequestEmail({ name, email, companyName, jobTitle, phone }) {
  return {
    subject: `${BRAND_NAME} — New request from ${companyName}`,
    text: `${name || 'Someone'} (${email}) submitted a workspace request for "${companyName}". Review and approve it from the Approval section of the Super Admin console.`,
    html: baseTemplate({
      heading: 'New request pending approval',
      intro: `<strong>${esc(name || 'Someone')}</strong> just submitted a workspace request for <strong>${esc(companyName)}</strong>.`,
      details: [
        { label: 'Company', value: companyName },
        { label: 'Contact', value: name },
        { label: 'Email', value: email },
        { label: 'Job title', value: jobTitle },
        { label: 'Phone', value: phone },
      ],
      footnote: `Review and approve it from the Approval section of the Super Admin console.`,
    }),
  };
}
