import sendSystemMail from './parsefunction/sendSystemMail.js';
import {
  BRAND_NAME,
  formatWhen,
  loginAlertEmail,
  twoFactorEnabledEmail,
  twoFactorDisabledEmail,
} from './emailTemplates.js';

// These are courtesy notifications, never preconditions. A dead SMTP host
// must not turn a successful login into a failed one, so every send here is
// fire-and-forget: awaited internally so errors are caught and logged, but
// the caller is expected NOT to await the returned promise.
function fireAndForget(label, promise) {
  promise.catch(err => console.log(`${label} notification failed:`, err?.message || err));
}

function recipientFrom(extUser) {
  return {
    email: extUser.get('Email'),
    name: extUser.get('Name') || '',
  };
}

// Best-effort client fingerprint. Behind the company proxy the socket
// address is the proxy's, so x-forwarded-for is checked first; its leftmost
// entry is the original client.
export function clientInfo(request) {
  const headers = request?.headers || {};
  const forwarded = headers['x-forwarded-for'];
  const ip = (forwarded ? String(forwarded).split(',')[0] : '').trim() || request?.ip || '';
  const ua = headers['user-agent'] || '';
  // Full UA strings are unreadable in an email; surface just the browser and
  // platform, which is what a user actually checks against "was that me?".
  let device = '';
  if (ua) {
    const browser =
      /edg\//i.test(ua) ? 'Edge'
      : /opr\//i.test(ua) ? 'Opera'
      : /chrome\//i.test(ua) ? 'Chrome'
      : /safari\//i.test(ua) ? 'Safari'
      : /firefox\//i.test(ua) ? 'Firefox'
      : '';
    const os =
      /windows/i.test(ua) ? 'Windows'
      : /android/i.test(ua) ? 'Android'
      : /iphone|ipad/i.test(ua) ? 'iOS'
      : /mac os/i.test(ua) ? 'macOS'
      : /linux/i.test(ua) ? 'Linux'
      : '';
    device = [browser, os].filter(Boolean).join(' on ') || undefined;
  }
  return { ip: ip || undefined, device };
}

export function notifyLogin(extUser, meta = {}) {
  const { email, name } = recipientFrom(extUser);
  if (!email) return;
  const mail = loginAlertEmail({
    name,
    email,
    when: formatWhen(),
    ip: meta.ip,
    device: meta.device,
  });
  fireAndForget(
    'login',
    sendSystemMail({
      params: {
        from: BRAND_NAME,
        recipient: email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        extUserId: extUser.id,
      },
    })
  );
}

export function notifyTwoFactorChange(extUser, enabled) {
  const { email, name } = recipientFrom(extUser);
  if (!email) return;
  const build = enabled ? twoFactorEnabledEmail : twoFactorDisabledEmail;
  const mail = build({ name, email, when: formatWhen() });
  fireAndForget(
    enabled ? '2fa-enabled' : '2fa-disabled',
    sendSystemMail({
      params: {
        from: BRAND_NAME,
        recipient: email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        extUserId: extUser.id,
      },
    })
  );
}
