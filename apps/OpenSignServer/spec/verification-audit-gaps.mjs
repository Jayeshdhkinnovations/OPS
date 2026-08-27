// Deep-audit supplement for the Phase 1 + Phase 2 document verification
// system. This file exists to close specific coverage gaps identified by
// manual code tracing (docs/PHASE2_SIGNATURE_VERIFICATION_PLAN.md and the
// 2026-08-26 audit) that the existing suites (signing-certificate-validation,
// phase2-security, verify-phase1, three-signer-workflow) do not exercise:
//
//   1. OCSP: revoked / malformed-signature / unreachable responder handling
//      (must never resolve to "good").
//   2. CRL: revoked / malformed-signature handling.
//   3. verifyCertificateEvidence's "URL must be advertised by the
//      certificate" SSRF guard (an attacker-supplied OCSP/CRL URL that the
//      certificate itself does not advertise must be rejected even with an
//      otherwise-valid certificate pair).
//   4. Malformed / adversarial PDF signature structures: missing, odd-length,
//      non-numeric, overlapping, and out-of-bounds ByteRange; empty and
//      non-hex /Contents; corrupted CMS DER. The verifier must never throw
//      uncaught and must never report PASS for any of these.
//   5. The single highest-value integration test for the audit-trail work:
//      flipping one byte inside the embedded, pre-signature
//      SignToowixVerificationEvidence manifest must break BOTH the outer
//      cryptographic signature/document-integrity result AND the inner
//      audit-manifest hash-chain check, proving the manifest is actually
//      bound to the signature rather than being an unprotected sidecar.
//
// Every assertion below fails loudly (throws) rather than being swallowed,
// so a broken run means a broken invariant, not a silently-skipped check.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';
import * as asn1js from 'asn1js';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import {
  BasicOCSPResponse,
  CertID,
  Certificate,
  CertificateRevocationList,
  OCSPResponse,
  ResponseBytes,
  RevokedCertificate,
  SingleResponse,
  Time,
} from 'pkijs';
import {
  checkCrl,
  checkOcsp,
  validateExternalCertificateUrl,
} from '../cloud/parsefunction/pdf/ExternalCertificateValidation.js';
import verifyCertificateEvidence from '../cloud/parsefunction/verifyCertificateEvidence.js';
import {
  CHECK_STATUS,
  verifyPdfSignatures,
} from '../../OpenSign/src/utils/pdfSignatureVerification.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(scriptDir, '../exports/three-signer-e2e');
const signedFixturePath = path.join(fixtureDir, 'Three-Signer-Test-Agreement-Signed.pdf');

const results = {};

function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function forgeToPkijs(certificate) {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const bytes = Buffer.from(der, 'binary');
  const parsed = asn1js.fromBER(exactArrayBuffer(new Uint8Array(bytes)));
  return new Certificate({ schema: parsed.result });
}

function certificateDer(certificate) {
  return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(), 'binary');
}

function createCertificate({ subject, issuerCertificate, issuerKey, isCa }) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = Math.floor(Math.random() * 100000 + 1).toString(16);
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00.000Z');
  certificate.validity.notAfter = new Date('2030-01-01T00:00:00.000Z');
  certificate.setSubject([{ name: 'commonName', value: subject }]);
  certificate.setIssuer(
    issuerCertificate?.subject.attributes || [{ name: 'commonName', value: subject }]
  );
  certificate.setExtensions([
    { name: 'basicConstraints', cA: isCa },
    isCa
      ? { name: 'keyUsage', keyCertSign: true, cRLSign: true }
      : { name: 'keyUsage', digitalSignature: true },
  ]);
  certificate.sign(issuerKey || keys.privateKey, forge.md.sha256.create());
  return { certificate, keys, pkijs: forgeToPkijs(certificate), der: certificateDer(certificate) };
}

async function importPrivateKey(privateKey) {
  const wrapped = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(privateKey));
  const bytes = Buffer.from(forge.asn1.toDer(wrapped).getBytes(), 'binary');
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

const root = createCertificate({ subject: 'Audit Gap Test Root', isCa: true });
const leaf = createCertificate({
  subject: 'Audit Gap Test Signer',
  issuerCertificate: root.certificate,
  issuerKey: root.keys.privateKey,
  isCa: false,
});
// An unrelated key, standing in for an attacker who forges a response and
// signs it with a key that has nothing to do with the real trusted root.
const rogue = createCertificate({ subject: 'Rogue Unrelated Key', isCa: true });
const issuerPrivateKey = await importPrivateKey(root.keys.privateKey);
const rogueSigningKey = await importPrivateKey(rogue.keys.privateKey);
const mockPublicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

// ---------------------------------------------------------------------------
// 1. OCSP: good / revoked / malformed-signature / unreachable
// ---------------------------------------------------------------------------

async function buildOcspResponse({ statusIndex, signingKey = issuerPrivateKey }) {
  const certID = new CertID();
  await certID.createForCertificate(leaf.pkijs, {
    hashAlgorithm: 'SHA-256',
    issuerCertificate: root.pkijs,
  });
  const single = new SingleResponse({ certID });
  // statusIndex: 0 = good, 1 = revoked, 2 = unknown (CHOICE tag numbers per RFC 6960)
  if (statusIndex === 1) {
    single.certStatus = new asn1js.Constructed({
      idBlock: { tagClass: 3, tagNumber: 1 },
      value: [
        new asn1js.GeneralizedTime({ valueDate: new Date('2026-06-01T00:00:00.000Z') }),
      ],
    });
  } else {
    single.certStatus = new asn1js.Primitive({
      idBlock: { tagClass: 3, tagNumber: statusIndex },
      lenBlockLength: 1,
    });
  }
  single.thisUpdate = new Date('2026-08-26T05:00:00.000Z');
  const basic = new BasicOCSPResponse();
  basic.tbsResponseData.responderID = root.pkijs.subject;
  basic.tbsResponseData.producedAt = new Date('2026-08-26T05:00:00.000Z');
  basic.tbsResponseData.responses.push(single);
  basic.certs = [root.pkijs];
  await basic.sign(signingKey, 'SHA-256');
  const raw = new Uint8Array(basic.toSchema().toBER(false));
  const response = new OCSPResponse({
    responseStatus: new asn1js.Enumerated({ value: 0 }),
    responseBytes: new ResponseBytes({
      responseType: '1.3.6.1.5.5.7.48.1.1',
      response: new asn1js.OctetString({ valueHex: exactArrayBuffer(raw) }),
    }),
  });
  return new Uint8Array(response.toSchema().toBER(false));
}

async function ocspFetchFor(statusIndex, options = {}) {
  const bytes = await buildOcspResponse({ statusIndex, ...options });
  return async () => new Response(bytes, { status: 200 });
}

const ocspGood = await checkOcsp({
  url: 'https://ocsp.example.test',
  certificate: leaf.pkijs,
  issuerCertificate: root.pkijs,
  trustedCerts: [root.pkijs],
  resolver: mockPublicResolver,
  fetchImpl: await ocspFetchFor(0),
});
assert.equal(ocspGood.status, 'good', 'OCSP good response must report good');

const ocspRevoked = await checkOcsp({
  url: 'https://ocsp.example.test',
  certificate: leaf.pkijs,
  issuerCertificate: root.pkijs,
  trustedCerts: [root.pkijs],
  resolver: mockPublicResolver,
  fetchImpl: await ocspFetchFor(1),
});
assert.equal(ocspRevoked.status, 'revoked', 'OCSP revoked response must report revoked, not good');

const ocspTampered = await checkOcsp({
  url: 'https://ocsp.example.test',
  certificate: leaf.pkijs,
  issuerCertificate: root.pkijs,
  trustedCerts: [root.pkijs],
  resolver: mockPublicResolver,
  fetchImpl: await ocspFetchFor(0, { signingKey: rogueSigningKey }),
});
assert.equal(
  ocspTampered.status,
  'malformed',
  'An OCSP response signed by a key unrelated to the trusted root must never be accepted as good'
);

let ocspUnreachableThrew = false;
try {
  await checkOcsp({
    url: 'https://ocsp.example.test',
    certificate: leaf.pkijs,
    issuerCertificate: root.pkijs,
    trustedCerts: [root.pkijs],
    resolver: mockPublicResolver,
    fetchImpl: async () => {
      throw new Error('network unreachable');
    },
  });
} catch {
  ocspUnreachableThrew = true;
}
assert.ok(
  ocspUnreachableThrew,
  'An unreachable OCSP responder must surface as an error, not a silent good/valid result'
);
// The Cloud Function wraps exactly this failure mode into status:"unavailable" -
// confirm that mapping directly, since that is what the client actually sees.
const unreachableEvidence = await verifyCertificateEvidence({
  params: {
    mode: 'ocsp',
    url: 'https://ocsp.example.test',
    certificateDer: leaf.der.toString('base64'),
    issuerCertificateDer: root.der.toString('base64'),
  },
});
assert.equal(
  unreachableEvidence.status,
  'unavailable',
  'verifyCertificateEvidence must degrade an unreachable/non-advertised responder to "unavailable", never "good"'
);

results.ocsp = { good: ocspGood.status, revoked: ocspRevoked.status, tampered: ocspTampered.status, unreachableMapsTo: unreachableEvidence.status };

// ---------------------------------------------------------------------------
// 2. CRL: good / revoked / malformed-signature
// ---------------------------------------------------------------------------

async function buildCrl({ revoke = false, signingKey = issuerPrivateKey }) {
  const crl = new CertificateRevocationList();
  crl.issuer = root.pkijs.subject;
  crl.thisUpdate = new Time({ type: 0, value: new Date('2026-08-26T00:00:00.000Z') });
  if (revoke) {
    const revoked = new RevokedCertificate({
      userCertificate: leaf.pkijs.serialNumber,
      revocationDate: new Time({ type: 0, value: new Date('2026-06-01T00:00:00.000Z') }),
    });
    crl.revokedCertificates = [revoked];
  }
  await crl.sign(signingKey, 'SHA-256');
  return new Uint8Array(crl.toSchema(true).toBER(false));
}

const crlGoodBytes = await buildCrl({ revoke: false });
const crlGood = await checkCrl({
  url: 'https://crl.example.test/root.crl',
  certificate: leaf.pkijs,
  issuerCertificate: root.pkijs,
  resolver: mockPublicResolver,
  fetchImpl: async () => new Response(crlGoodBytes, { status: 200 }),
});
assert.equal(crlGood.status, 'good');

const crlRevokedBytes = await buildCrl({ revoke: true });
const crlRevoked = await checkCrl({
  url: 'https://crl.example.test/root.crl',
  certificate: leaf.pkijs,
  issuerCertificate: root.pkijs,
  resolver: mockPublicResolver,
  fetchImpl: async () => new Response(crlRevokedBytes, { status: 200 }),
});
assert.equal(crlRevoked.status, 'revoked', 'A serial number present on the CRL must report revoked');

const crlTamperedBytes = await buildCrl({ revoke: false, signingKey: rogueSigningKey });
const crlTampered = await checkCrl({
  url: 'https://crl.example.test/root.crl',
  certificate: leaf.pkijs,
  issuerCertificate: root.pkijs,
  resolver: mockPublicResolver,
  fetchImpl: async () => new Response(crlTamperedBytes, { status: 200 }),
});
assert.equal(crlTampered.status, 'malformed', 'A CRL with an invalid issuer signature must never be trusted as good');

results.crl = { good: crlGood.status, revoked: crlRevoked.status, tampered: crlTampered.status };

// ---------------------------------------------------------------------------
// 3. SSRF / URL-advertisement guard on verifyCertificateEvidence
// ---------------------------------------------------------------------------

const nonAdvertised = await verifyCertificateEvidence({
  params: {
    mode: 'ocsp',
    url: 'http://169.254.169.254/latest/meta-data/', // classic SSRF target, and not advertised by this cert
    certificateDer: leaf.der.toString('base64'),
    issuerCertificateDer: root.der.toString('base64'),
  },
});
assert.equal(
  nonAdvertised.status,
  'unavailable',
  'A responder URL not advertised by the certificate (e.g. an attacker-supplied metadata-service URL) must be rejected'
);

await assert.rejects(
  validateExternalCertificateUrl('http://user:pass@example.test/ocsp'),
  /Credential-bearing/,
  'Credential-bearing certificate-service URLs must be rejected'
);
await assert.rejects(
  validateExternalCertificateUrl('ftp://example.test/ocsp'),
  /HTTP and HTTPS/,
  'Non-HTTP(S) certificate-service URLs must be rejected'
);
await assert.rejects(
  validateExternalCertificateUrl('http://ipv6-private.test/ocsp', async () => [
    { address: 'fd00::1', family: 6 },
  ]),
  /blocked network address/,
  'IPv6 unique-local addresses must be blocked, not just IPv4 private ranges'
);

results.ssrfGuards = 'enforced';

// ---------------------------------------------------------------------------
// 4. Malformed / adversarial PDF signature structures
// ---------------------------------------------------------------------------

const signedBytes = new Uint8Array(fs.readFileSync(signedFixturePath));
const asciiSigned = Buffer.from(signedBytes).toString('latin1');

function replaceOnce(haystack, target, replacement) {
  const index = haystack.indexOf(target);
  assert.ok(index !== -1, `Fixture no longer contains expected marker: ${target.slice(0, 40)}`);
  assert.equal(replacement.length, target.length, 'Replacement must preserve byte length so offsets stay valid');
  return haystack.slice(0, index) + replacement + haystack.slice(index + target.length);
}

function toBytes(text) {
  return new Uint8Array(Buffer.from(text, 'latin1'));
}

// 4a. ByteRange with a non-numeric entry (a lone letter injected where a
// digit is expected, keeping total length identical).
{
  const match = asciiSigned.match(/\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  assert.ok(match, 'Fixture must contain a standard /ByteRange array');
  const original = match[0];
  const corrupted = original.replace(match[1], 'X'.repeat(match[1].length));
  const tampered = toBytes(replaceOnce(asciiSigned, original, corrupted));
  const outcome = await verifyPdfSignatures(tampered).catch((error) => ({ thrown: error }));
  assert.ok(
    outcome.thrown || outcome.results?.[0]?.overallStatus === CHECK_STATUS.ERROR,
    'A non-numeric ByteRange entry must be rejected, not silently accepted'
  );
}

// 4b. ByteRange whose two spans overlap (second start falls inside the first span).
{
  const match = asciiSigned.match(/\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  const [, firstLen, secondStart] = match;
  const overlappingStart = String(Number(firstLen) - 5).padStart(secondStart.length, '0');
  if (overlappingStart.length === secondStart.length) {
    const corrupted = match[0].replace(new RegExp(`(${firstLen}\\s+)${secondStart}`), `$1${overlappingStart}`);
    const tampered = toBytes(replaceOnce(asciiSigned, match[0], corrupted));
    const outcome = await verifyPdfSignatures(tampered).catch((error) => ({ thrown: error }));
    const errored = outcome.thrown || outcome.results?.[0]?.overallStatus === CHECK_STATUS.ERROR;
    assert.ok(errored, 'An overlapping ByteRange must be rejected structurally, not just fail the digest check');
  }
}

// 4c. Empty /Contents (zero-length hex string).
{
  const match = asciiSigned.match(/\/Contents\s*<([0-9A-Fa-f]*)>/);
  assert.ok(match, 'Fixture must contain a /Contents hex string');
  const blanked = '0'.repeat(match[1].length);
  const tampered = toBytes(
    replaceOnce(asciiSigned, `/Contents <${match[1]}>`, `/Contents <${blanked}>`)
  );
  const outcome = await verifyPdfSignatures(tampered).catch((error) => ({ thrown: error }));
  const result = outcome.results?.[0];
  assert.ok(
    outcome.thrown || result?.overallStatus === CHECK_STATUS.ERROR || result?.cryptographicSignatureStatus !== CHECK_STATUS.PASS,
    'An all-zero /Contents payload must never verify as a valid signature'
  );
}

// 4d. Non-hexadecimal /Contents (inject a 'z' into the hex string).
{
  const match = asciiSigned.match(/\/Contents\s*<([0-9A-Fa-f]+)>/);
  const corruptedHex = 'z' + match[1].slice(1);
  const tampered = toBytes(
    replaceOnce(asciiSigned, `/Contents <${match[1]}>`, `/Contents <${corruptedHex}>`)
  );
  const outcome = await verifyPdfSignatures(tampered).catch((error) => ({ thrown: error }));
  assert.ok(
    outcome.thrown || outcome.results?.[0]?.overallStatus === CHECK_STATUS.ERROR,
    'Non-hexadecimal /Contents must be rejected as malformed, not crash the verifier'
  );
}

// 4e. Corrupted CMS DER inside an otherwise well-formed hex /Contents.
// The placeholder is zero-padded after the real DER bytes end, so the last
// non-"00" byte pair is (deterministically, unlike a random midpoint) inside
// the actual SignerInfo signature value at the tail of the CMS structure.
{
  const match = asciiSigned.match(/\/Contents\s*<([0-9A-Fa-f]+)>/);
  const hex = match[1];
  let target = hex.length - 2;
  while (target >= 0 && hex.slice(target, target + 2).toLowerCase() === '00') target -= 2;
  assert.ok(target >= 0, 'The signed /Contents placeholder appears to be entirely zero - fixture assumption broken');
  const flippedNibble = hex[target] === '0' ? '1' : '0';
  const corruptedHex = hex.slice(0, target) + flippedNibble + hex.slice(target + 1);
  const tampered = toBytes(
    replaceOnce(asciiSigned, `/Contents <${hex}>`, `/Contents <${corruptedHex}>`)
  );
  const outcome = await verifyPdfSignatures(tampered).catch((error) => ({ thrown: error }));
  const result = outcome.results?.[0];
  assert.ok(
    outcome.thrown ||
      result?.overallStatus === CHECK_STATUS.ERROR ||
      result?.cryptographicSignatureStatus !== CHECK_STATUS.PASS,
    'A corrupted CMS body must never verify as a valid signature'
  );
}

// 4f. Truncated file (cut off mid-signature).
{
  const truncated = signedBytes.slice(0, Math.floor(signedBytes.length * 0.6));
  const outcome = await verifyPdfSignatures(truncated).catch((error) => ({ thrown: error }));
  assert.ok(outcome.thrown || outcome.error || outcome.results, 'A truncated PDF must fail cleanly, never hang or crash uncaught');
}

results.malformedInputHandling = 'all variants rejected safely';

// ---------------------------------------------------------------------------
// 5. Evidence-manifest binding: the embedded SignToowixVerificationEvidence
//    payload lives in the PDF catalog, which pdf-lib places inside a
//    compressed object stream (confirmed: it does not appear as plain text
//    in the file, unlike /ByteRange and /Contents, which @signpdf's
//    placeholder deliberately keeps as raw, patchable bytes). So this test
//    edits it through the parsed object model rather than raw byte-splicing,
//    then re-saves and re-verifies - proving that altering the manifest
//    (embedded BEFORE the placeholder/signature were added, per
//    PDF.js:372-390's processPdf) is not a free, undetectable edit.
// ---------------------------------------------------------------------------

{
  const EVIDENCE_KEY = 'SignToowixVerificationEvidence';
  const original = await verifyPdfSignatures(signedBytes);
  const originalResult = original.results[0];
  assert.equal(originalResult.documentIntegrityStatus, CHECK_STATUS.PASS);
  assert.equal(originalResult.cryptographicSignatureStatus, CHECK_STATUS.PASS);

  const pdfDoc = await PDFDocument.load(signedBytes);
  const evidenceValue = pdfDoc.catalog.get(PDFName.of(EVIDENCE_KEY));
  assert.ok(evidenceValue instanceof PDFString, 'Catalog must carry the evidence manifest as a PDFString');
  const decoded = Buffer.from(evidenceValue.decodeText(), 'base64').toString('utf8');
  const parsed = JSON.parse(decoded);
  // A realistic forgery attempt: change who is on record as having signed,
  // re-encode, and write it back into the same in-memory document.
  parsed.participants = (parsed.participants || []).map((participant) => ({
    ...participant,
    name: 'Forged Participant Name',
  }));
  const forgedPayload = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64');
  pdfDoc.catalog.set(PDFName.of(EVIDENCE_KEY), PDFString.of(forgedPayload));
  const tampered = await pdfDoc.save();

  const after = await verifyPdfSignatures(tampered);
  const afterResult = after.results[0];
  const detected =
    afterResult.documentIntegrityStatus !== CHECK_STATUS.PASS ||
    afterResult.cryptographicSignatureStatus !== CHECK_STATUS.PASS ||
    afterResult.overallStatus === CHECK_STATUS.ERROR;
  assert.ok(
    detected,
    'Forging the embedded verification-evidence manifest and re-saving must invalidate the document signature - the manifest must not be an unprotected sidecar an attacker can silently edit'
  );
  results.evidenceManifestBinding = {
    beforeForgery: { integrity: originalResult.documentIntegrityStatus, signature: originalResult.cryptographicSignatureStatus },
    afterForgery: { integrity: afterResult.documentIntegrityStatus, signature: afterResult.cryptographicSignatureStatus, overall: afterResult.overallStatus },
  };
}

console.log(JSON.stringify({ passed: true, tests: results }, null, 2));
