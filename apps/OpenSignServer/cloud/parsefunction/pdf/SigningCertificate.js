import forge from 'node-forge';
import fs from 'node:fs';

export const SIGNING_CERTIFICATE_STATUS = Object.freeze({
  VALID: 'valid',
  EXPIRED: 'expired',
  NOT_YET_VALID: 'not_yet_valid',
  INVALID: 'invalid',
});

export class SigningCertificateError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SigningCertificateError';
    this.code = code;
  }
}

function exactBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new SigningCertificateError(
    SIGNING_CERTIFICATE_STATUS.INVALID,
    'The signing certificate must be provided as binary PFX data.'
  );
}

function localKeyIdHex(bag) {
  const localKeyId = bag?.attributes?.localKeyId?.[0];
  return localKeyId ? forge.util.bytesToHex(localKeyId) : '';
}

function selectSigningCertificate(p12) {
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  if (!certBags?.length) {
    throw new SigningCertificateError(
      SIGNING_CERTIFICATE_STATUS.INVALID,
      'The PFX does not contain a signing certificate.'
    );
  }

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  if (!keyBags.length) {
    throw new SigningCertificateError(
      SIGNING_CERTIFICATE_STATUS.INVALID,
      'The PFX does not contain a private signing key.'
    );
  }

  const keyIds = new Set(keyBags.map(localKeyIdHex).filter(Boolean));
  const matchingBag = certBags.find(bag => keyIds.has(localKeyIdHex(bag)));
  const certificateBag = matchingBag || (certBags.length === 1 ? certBags[0] : null);
  if (!certificateBag?.cert) {
    throw new SigningCertificateError(
      SIGNING_CERTIFICATE_STATUS.INVALID,
      'The PFX certificate could not be matched to its private signing key.'
    );
  }
  return certificateBag.cert;
}

export function getSigningCertificateDateStatus(certificate, at = new Date()) {
  const checkTime = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(checkTime.getTime())) {
    throw new SigningCertificateError(
      SIGNING_CERTIFICATE_STATUS.INVALID,
      'The signing certificate validation time is invalid.'
    );
  }
  if (checkTime < certificate.validity.notBefore) {
    return SIGNING_CERTIFICATE_STATUS.NOT_YET_VALID;
  }
  if (checkTime > certificate.validity.notAfter) {
    return SIGNING_CERTIFICATE_STATUS.EXPIRED;
  }
  return SIGNING_CERTIFICATE_STATUS.VALID;
}

export function inspectSigningCertificate(pfxBytes, passphrase, at = new Date()) {
  try {
    const buffer = exactBuffer(pfxBytes);
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(buffer.toString('binary')));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase || '');
    const certificate = selectSigningCertificate(p12);
    const status = getSigningCertificateDateStatus(certificate, at);
    const commonName = certificate.subject.getField('CN')?.value || '';

    return {
      status,
      commonName,
      subject: certificate.subject.attributes
        .map(attribute => `${attribute.shortName || attribute.name}=${attribute.value}`)
        .join(', '),
      issuer: certificate.issuer.attributes
        .map(attribute => `${attribute.shortName || attribute.name}=${attribute.value}`)
        .join(', '),
      notBefore: new Date(certificate.validity.notBefore),
      notAfter: new Date(certificate.validity.notAfter),
    };
  } catch (error) {
    if (error instanceof SigningCertificateError) throw error;
    throw new SigningCertificateError(
      SIGNING_CERTIFICATE_STATUS.INVALID,
      'The signing PFX is invalid, corrupted, or protected by a different passphrase.',
      error
    );
  }
}

export function validateSigningCertificate(pfxBytes, passphrase, at = new Date()) {
  const inspection = inspectSigningCertificate(pfxBytes, passphrase, at);
  if (inspection.status === SIGNING_CERTIFICATE_STATUS.EXPIRED) {
    throw new SigningCertificateError(
      SIGNING_CERTIFICATE_STATUS.EXPIRED,
      `The signing certificate${inspection.commonName ? ` (${inspection.commonName})` : ''} expired on ${inspection.notAfter.toISOString()}. Replace it before signing.`
    );
  }
  if (inspection.status === SIGNING_CERTIFICATE_STATUS.NOT_YET_VALID) {
    throw new SigningCertificateError(
      SIGNING_CERTIFICATE_STATUS.NOT_YET_VALID,
      `The signing certificate${inspection.commonName ? ` (${inspection.commonName})` : ''} is not valid until ${inspection.notBefore.toISOString()}.`
    );
  }
  return inspection;
}

function decodeAndValidate(base64, passphrase, source) {
  try {
    const buffer = Buffer.from(base64, 'base64');
    validateSigningCertificate(buffer, passphrase);
    return { buffer, passphrase, source };
  } catch (error) {
    throw new SigningCertificateError(
      error?.code || SIGNING_CERTIFICATE_STATUS.INVALID,
      `${source}: ${error.message}`,
      error
    );
  }
}

export function resolveSigningCertificate({ tenantPfx, fallbackPath = './keystore_681.pfx' } = {}) {
  if (tenantPfx?.base64) {
    return decodeAndValidate(
      tenantPfx.base64,
      tenantPfx.password || '',
      'Tenant signing certificate'
    );
  }

  if (process.env.PFX_BASE64) {
    return decodeAndValidate(
      process.env.PFX_BASE64,
      process.env.PASS_PHRASE || '',
      'Configured signing certificate'
    );
  }

  const developmentFallbackAllowed =
    process.env.NODE_ENV !== 'production' &&
    String(process.env.ALLOW_REPOSITORY_PFX_FOR_DEVELOPMENT).toLowerCase() === 'true';
  if (!developmentFallbackAllowed) {
    throw new SigningCertificateError(
      SIGNING_CERTIFICATE_STATUS.INVALID,
      'No signing certificate is configured. Configure a tenant certificate or PFX_BASE64; repository fallback is disabled.'
    );
  }

  const developmentPassphrase = process.env.DEVELOPMENT_PFX_PASSPHRASE;
  if (!developmentPassphrase) {
    throw new SigningCertificateError(
      SIGNING_CERTIFICATE_STATUS.INVALID,
      'DEVELOPMENT_PFX_PASSPHRASE is required when the development repository PFX is enabled.'
    );
  }

  try {
    const buffer = fs.readFileSync(fallbackPath);
    validateSigningCertificate(buffer, developmentPassphrase);
    return {
      buffer,
      passphrase: developmentPassphrase,
      source: 'Development repository signing certificate',
    };
  } catch (error) {
    if (error instanceof SigningCertificateError) throw error;
    throw new SigningCertificateError(
      SIGNING_CERTIFICATE_STATUS.INVALID,
      `Development repository signing certificate could not be loaded: ${error.message}`,
      error
    );
  }
}
