// Resolves signing IPs (already embedded in a document's protected
// verification-evidence manifest - see VerificationEvidence.js) to the city
// and timezone they were signed from, for display on the public
// verify-document page. Same provider/guards as GenerateCertificate.js's
// resolveIpGeo and securityNotifications.js's locationFor: ipwho.is, no API
// key, short timeout, private/loopback ranges skipped. The destination host
// is fixed (ipwho.is) and only the path segment is caller-supplied, so this
// carries none of the SSRF risk a caller-supplied URL would (see
// verifyCertificateEvidence.js for that class of check).
const IP_PATTERN =
  /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[0-9a-fA-F:]+)$/;
const MAX_IPS_PER_REQUEST = 20;

const EMPTY_GEO = {
  city: '',
  region: '',
  country: '',
  countryCode: '',
  timezoneId: '',
  timezoneAbbr: '',
};

async function resolveOne(ip) {
  if (!ip || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1)/.test(ip)) {
    return { ...EMPTY_GEO };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ...EMPTY_GEO };
    const json = await res.json();
    if (!json.success) return { ...EMPTY_GEO };
    return {
      city: json.city || '',
      region: json.region || '',
      country: json.country || '',
      countryCode: json.country_code || '',
      timezoneId: json.timezone?.id || '',
      timezoneAbbr: json.timezone?.abbr || '',
    };
  } catch {
    return { ...EMPTY_GEO };
  }
}

export default async function resolveIpGeo(request) {
  const ips = Array.isArray(request?.params?.ips) ? request.params.ips : [];
  const uniqueValid = [
    ...new Set(ips.filter(ip => typeof ip === 'string' && IP_PATTERN.test(ip))),
  ].slice(0, MAX_IPS_PER_REQUEST);

  const entries = await Promise.all(uniqueValid.map(async ip => [ip, await resolveOne(ip)]));
  return Object.fromEntries(entries);
}
