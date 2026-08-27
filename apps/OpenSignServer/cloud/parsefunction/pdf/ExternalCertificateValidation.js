import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as asn1js from 'asn1js';
import {
  BasicOCSPResponse,
  Certificate,
  CertificateRevocationList,
  MessageImprint,
  OCSPRequest,
  OCSPResponse,
  TimeStampReq,
  TimeStampResp,
} from 'pkijs';

const MAX_RESPONSE_BYTES = 1024 * 1024;

function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function privateAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const normalized = address.toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff')
  );
}

export async function validateExternalCertificateUrl(value, resolver = lookup) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS certificate-service URLs are allowed.');
  }
  if (url.username || url.password) throw new Error('Credential-bearing URLs are not allowed.');
  const addresses = await resolver(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) {
    throw new Error('The certificate-service URL resolves to a blocked network address.');
  }
  return url;
}

async function boundedResponse(response) {
  if (!response.ok) throw new Error(`Certificate service returned HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error('Certificate-service response is too large.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES)
    throw new Error('Certificate-service response is too large.');
  return bytes;
}

async function safePost(url, body, contentType, options = {}) {
  await validateExternalCertificateUrl(url, options.resolver || lookup);
  const response = await (options.fetchImpl || fetch)(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Accept: '*/*' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs || 8000),
  });
  return boundedResponse(response);
}

async function safeGet(url, options = {}) {
  await validateExternalCertificateUrl(url, options.resolver || lookup);
  const response = await (options.fetchImpl || fetch)(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs || 8000),
  });
  return boundedResponse(response);
}

export function parseDerCertificate(base64) {
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  const parsed = asn1js.fromBER(exactArrayBuffer(bytes));
  if (parsed.offset === -1) throw new Error('Certificate DER could not be parsed.');
  return new Certificate({ schema: parsed.result });
}

export function getCertificateServiceUrls(certificate) {
  const urls = { ocsp: [], crl: [] };
  for (const extension of certificate?.extensions || []) {
    if (extension.extnID === '1.3.6.1.5.5.7.1.1') {
      for (const description of extension.parsedValue?.accessDescriptions || []) {
        if (
          description.accessMethod === '1.3.6.1.5.5.7.48.1' &&
          typeof description.accessLocation?.value === 'string'
        ) {
          urls.ocsp.push(description.accessLocation.value);
        }
      }
    }
    if (extension.extnID === '2.5.29.31') {
      for (const point of extension.parsedValue?.distributionPoints || []) {
        for (const name of point.distributionPoint || []) {
          if (typeof name?.value === 'string') urls.crl.push(name.value);
        }
      }
    }
  }
  return urls;
}

export async function requestRfc3161Timestamp({ url, data, trustedCerts = [], ...options }) {
  const message = data instanceof Uint8Array ? data : new Uint8Array(data);
  const messageImprint = await MessageImprint.create('SHA-256', exactArrayBuffer(message));
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = new asn1js.Integer({ valueHex: exactArrayBuffer(nonceBytes) });
  const request = new TimeStampReq({ version: 1, messageImprint, nonce, certReq: true });
  const requestBytes = new Uint8Array(request.toSchema().toBER(false));
  const responseBytes = await safePost(url, requestBytes, 'application/timestamp-query', options);
  const parsed = asn1js.fromBER(exactArrayBuffer(responseBytes));
  if (parsed.offset === -1) throw new Error('The TSA response is malformed.');
  const timestamp = new TimeStampResp({ schema: parsed.result });
  const status =
    typeof timestamp.status.status === 'number'
      ? timestamp.status.status
      : timestamp.status.status.valueBlock.valueDec;
  if (![0, 1].includes(status) || !timestamp.timeStampToken) {
    throw new Error(`The TSA rejected the request with status ${status}.`);
  }
  const signatureValid = await timestamp.verify({
    signer: 0,
    data: exactArrayBuffer(message),
    trustedCerts,
  });
  if (!signatureValid) throw new Error('The RFC 3161 timestamp response did not verify.');
  return {
    status: trustedCerts.length ? 'trusted' : 'valid_untrusted_tsa',
    token: Buffer.from(responseBytes).toString('base64'),
  };
}

export async function checkOcsp({ url, certificate, issuerCertificate, trustedCerts, ...options }) {
  const request = new OCSPRequest();
  await request.createForCertificate(certificate, {
    hashAlgorithm: 'SHA-256',
    issuerCertificate,
  });
  const requestBytes = new Uint8Array(request.toSchema(true).toBER(false));
  const responseBytes = await safePost(url, requestBytes, 'application/ocsp-request', options);
  const parsed = asn1js.fromBER(exactArrayBuffer(responseBytes));
  if (parsed.offset === -1) throw new Error('The OCSP response is malformed.');
  const response = new OCSPResponse({ schema: parsed.result });
  if (response.responseStatus.valueBlock.valueDec !== 0 || !response.responseBytes) {
    return { status: 'unknown', source: 'ocsp' };
  }
  const basicParsed = asn1js.fromBER(response.responseBytes.response.valueBlock.valueHex);
  const basic = new BasicOCSPResponse({ schema: basicParsed.result });
  const valid = await basic.verify({
    trustedCerts: trustedCerts?.length ? trustedCerts : [issuerCertificate],
  });
  if (!valid) return { status: 'malformed', source: 'ocsp' };
  const result = await basic.getCertificateStatus(certificate, issuerCertificate);
  return {
    status: !result.isForCertificate ? 'unknown' : ['good', 'revoked', 'unknown'][result.status],
    source: 'ocsp',
  };
}

export async function checkCrl({ url, certificate, issuerCertificate, ...options }) {
  const responseBytes = await safeGet(url, options);
  const parsed = asn1js.fromBER(exactArrayBuffer(responseBytes));
  if (parsed.offset === -1) throw new Error('The CRL response is malformed.');
  const crl = new CertificateRevocationList({ schema: parsed.result });
  const valid = await crl.verify({ issuerCertificate });
  if (!valid) return { status: 'malformed', source: 'crl' };
  const serial = Buffer.from(certificate.serialNumber.valueBlock.valueHexView).toString('hex');
  const revoked = (crl.revokedCertificates || []).some(
    item => Buffer.from(item.userCertificate.valueBlock.valueHexView).toString('hex') === serial
  );
  return { status: revoked ? 'revoked' : 'good', source: 'crl' };
}
