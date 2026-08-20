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
    const browser = /edg\//i.test(ua)
      ? 'Edge'
      : /opr\//i.test(ua)
        ? 'Opera'
        : /chrome\//i.test(ua)
          ? 'Chrome'
          : /safari\//i.test(ua)
            ? 'Safari'
            : /firefox\//i.test(ua)
              ? 'Firefox'
              : '';
    const os = /windows/i.test(ua)
      ? 'Windows'
      : /android/i.test(ua)
        ? 'Android'
        : /iphone|ipad/i.test(ua)
          ? 'iOS'
          : /mac os/i.test(ua)
            ? 'macOS'
            : /linux/i.test(ua)
              ? 'Linux'
              : '';
    device = [browser, os].filter(Boolean).join(' on ') || undefined;
  }
  return { ip: ip || undefined, device };
}

// A bare IP address means nothing to the person reading the alert - "was
// that me?" is answerable from a city, not from 103.21.44.9. Resolved via a
// free lookup, with a short timeout: this runs inside a fire-and-forget send,
// so a slow or dead geo service must not hold the email up.
//
// ipapi.co was the original provider here, but its free tier is shared
// across all 8 company containers on this one server's outbound IP and was
// returning 429 RateLimited on every call - silently swallowed by the
// `if (!res.ok) return ''` below, which the email then showed as "Unknown"
// on every single login regardless of who was signing in. ipwho.is has no
// published low daily cap and needs no API key, so it's a drop-in swap; the
// response shape differs (`success` boolean instead of relying on `.ok`,
// but the same `city`/`region` fields), not just a URL change.
async function locationFor(ip) {
  if (!ip || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1)/.test(ip)) return '';
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return '';
    const j = await res.json();
    if (!j.success) return '';
    return [j.city, j.region].filter(Boolean).join(', ');
  } catch {
    return '';
  }
}

export function notifyLogin(extUser, meta = {}) {
  const { email, name } = recipientFrom(extUser);
  if (!email) return;
  fireAndForget(
    'login',
    locationFor(meta.ip).then(location => {
      const mail = loginAlertEmail({
        name,
        email,
        when: formatWhen(),
        location,
        device: meta.device,
      });
      return sendSystemMail({
        params: {
          from: BRAND_NAME,
          recipient: email,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          extUserId: extUser.id,
        },
      });
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
