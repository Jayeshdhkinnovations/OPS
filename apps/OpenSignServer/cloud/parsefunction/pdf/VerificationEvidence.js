import { createHash } from 'node:crypto';
import { PDFHexString, PDFName, PDFString } from 'pdf-lib';

export const VERIFICATION_EVIDENCE_KEY = 'SignToowixVerificationEvidence';
export const VERIFICATION_EVIDENCE_VERSION = 1;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function isoDate(value) {
  const source = value?.iso || value;
  if (!source) return null;
  const date = source instanceof Date ? source : new Date(source);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function shortHash(input) {
  let hash = 0;
  for (const character of String(input || '')) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

function pointerId(pointer) {
  return pointer?.objectId || pointer?.id || '';
}

function normalizedEvent(event, sequence, document) {
  const participantId = pointerId(event?.UserPtr);
  const signer = (document?.Signers || []).find(item => item?.objectId === participantId);
  const timestamp = isoDate(
    event?.SignedOn || event?.ViewedOn || event?.DeclinedOn || event?.createdAt || event?.updatedAt
  );
  const authentication = event?.Authentication || {
    method: 'unavailable',
    result: 'not_recorded',
  };
  return {
    sequence,
    type: String(event?.Activity || 'Unknown'),
    participantId,
    participantName: signer?.Name || event?.UserPtr?.Name || '',
    participantEmail: String(signer?.Email || event?.UserPtr?.Email || '')
      .trim()
      .toLowerCase(),
    timestamp,
    ipAddress: String(event?.ipAddress || ''),
    authentication: {
      method: String(authentication?.method || 'unavailable'),
      result: String(authentication?.result || 'unavailable'),
      verifiedAt: isoDate(authentication?.verifiedAt),
    },
  };
}

function protectEvents(events) {
  let previousHash = '0'.repeat(64);
  return events.map(event => {
    const protectedEvent = { ...event, previousHash };
    const hash = sha256(stableStringify(protectedEvent));
    previousHash = hash;
    return { ...protectedEvent, hash };
  });
}

export function buildVerificationEvidence({ document, auditTrail, completedAt }) {
  const completionTime = isoDate(completedAt) || new Date().toISOString();
  const dateKey = completionTime.slice(0, 10);
  const documentId = document?.objectId || '';
  const transactionId = `TXN-${dateKey}-${shortHash(documentId + 'txn')}`;
  const certificateId = `CERT-${dateKey}-${shortHash(documentId + completionTime)}`;
  const events = protectEvents(
    (auditTrail || []).map((event, sequence) => normalizedEvent(event, sequence, document))
  );
  const participants = (document?.Signers || []).map((signer, order) => {
    const event = [...events]
      .reverse()
      .find(item => item.participantId === signer.objectId && item.type === 'Signed');
    return {
      order: order + 1,
      participantId: signer.objectId || '',
      name: signer.Name || '',
      email: String(signer.Email || '')
        .trim()
        .toLowerCase(),
      signedAt: event?.timestamp || null,
      ipAddress: event?.ipAddress || '',
      authentication: event?.authentication || {
        method: 'unavailable',
        result: 'unavailable',
        verifiedAt: null,
      },
    };
  });
  const publicOrigin = String(process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
  const pageNumbers = (document?.Placeholders || [])
    .map(item => item?.pageNumber)
    .filter(Number.isFinite);
  const manifest = {
    schema: 'signatoowix-verification-evidence',
    version: VERIFICATION_EVIDENCE_VERSION,
    createdAt: completionTime,
    document: {
      documentId,
      name: document?.Name || '',
      transactionId,
      certificateId,
      completionTime,
      pageCount: pageNumbers.length ? Math.max(...pageNumbers) + 1 : null,
      verificationUrl: publicOrigin
        ? `${publicOrigin}/verify-document?certId=${encodeURIComponent(certificateId)}`
        : '',
    },
    signingArchitecture: 'single_platform_signature',
    revisionPolicy: { type: 'DocMDP', permission: 1 },
    participants,
    events,
    auditRoot: events.at(-1)?.hash || sha256(''),
  };
  return { ...manifest, manifestHash: sha256(stableStringify(manifest)) };
}

export function addTimestampEvidence(evidence, timestamp) {
  const { manifestHash: _oldHash, ...manifest } = evidence;
  const timestamped = { ...manifest, timestamp };
  return { ...timestamped, manifestHash: sha256(stableStringify(timestamped)) };
}

export function embedVerificationEvidence(pdfDoc, evidence) {
  const encoded = Buffer.from(JSON.stringify(evidence), 'utf8').toString('base64');
  pdfDoc.catalog.set(PDFName.of(VERIFICATION_EVIDENCE_KEY), PDFString.of(encoded));
}

export function extractVerificationEvidence(pdfDoc) {
  const value = pdfDoc.catalog.get(PDFName.of(VERIFICATION_EVIDENCE_KEY));
  if (!(value instanceof PDFString) && !(value instanceof PDFHexString)) return null;
  const encoded = value.decodeText();
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
}

export function mergeSignedAuditEvent(document, event) {
  const auditTrail = JSON.parse(JSON.stringify(document?.AuditTrail || []));
  const participantId = pointerId(event?.UserPtr);
  const existingIndex = auditTrail.findIndex(
    entry => pointerId(entry?.UserPtr) === participantId && entry?.Activity !== 'Created'
  );
  if (existingIndex === -1) auditTrail.push(event);
  else auditTrail[existingIndex] = { ...auditTrail[existingIndex], ...event };
  return auditTrail;
}
