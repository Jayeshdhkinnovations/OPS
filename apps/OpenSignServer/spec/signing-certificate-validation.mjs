import assert from 'node:assert/strict';
import fs from 'node:fs';
import forge from 'node-forge';
import {
  SIGNING_CERTIFICATE_STATUS,
  SigningCertificateError,
  inspectSigningCertificate,
  validateSigningCertificate,
} from '../cloud/parsefunction/pdf/SigningCertificate.js';

const PASSPHRASE = 'phase2-test';
const keyPair = forge.pki.rsa.generateKeyPair(1024);

function createTestPfx(notBefore, notAfter, serialNumber) {
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keyPair.publicKey;
  certificate.serialNumber = serialNumber;
  certificate.validity.notBefore = notBefore;
  certificate.validity.notAfter = notAfter;
  const attributes = [
    { name: 'commonName', value: 'SignToowix Phase 2 Test' },
    { name: 'organizationName', value: 'Testing Only' },
  ];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true },
  ]);
  certificate.sign(keyPair.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keyPair.privateKey, certificate, PASSPHRASE, {
    algorithm: '3des',
  });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
}

function expectCertificateError(action, expectedCode) {
  assert.throws(action, error => {
    assert.ok(error instanceof SigningCertificateError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

const now = new Date('2026-08-26T12:00:00.000Z');
const validPfx = createTestPfx(
  new Date('2026-08-25T00:00:00.000Z'),
  new Date('2027-08-25T00:00:00.000Z'),
  '01'
);
const expiredPfx = createTestPfx(
  new Date('2024-01-01T00:00:00.000Z'),
  new Date('2025-01-01T00:00:00.000Z'),
  '02'
);
const futurePfx = createTestPfx(
  new Date('2027-01-01T00:00:00.000Z'),
  new Date('2028-01-01T00:00:00.000Z'),
  '03'
);

assert.equal(
  validateSigningCertificate(validPfx, PASSPHRASE, now).status,
  SIGNING_CERTIFICATE_STATUS.VALID
);
expectCertificateError(
  () => validateSigningCertificate(expiredPfx, PASSPHRASE, now),
  SIGNING_CERTIFICATE_STATUS.EXPIRED
);
expectCertificateError(
  () => validateSigningCertificate(futurePfx, PASSPHRASE, now),
  SIGNING_CERTIFICATE_STATUS.NOT_YET_VALID
);
expectCertificateError(
  () => validateSigningCertificate(Buffer.from('not a pfx'), PASSPHRASE, now),
  SIGNING_CERTIFICATE_STATUS.INVALID
);
expectCertificateError(
  () => validateSigningCertificate(validPfx, 'wrong-passphrase', now),
  SIGNING_CERTIFICATE_STATUS.INVALID
);

const configuredPfx = fs.readFileSync(new URL('../keystore_681.pfx', import.meta.url));
const configuredCertificate = inspectSigningCertificate(configuredPfx, 'opensign', now);
assert.equal(configuredCertificate.status, SIGNING_CERTIFICATE_STATUS.VALID);
assert.equal(configuredCertificate.commonName, 'SignToowix');

console.log(
  JSON.stringify(
    {
      passed: true,
      tests: {
        validCertificate: SIGNING_CERTIFICATE_STATUS.VALID,
        expiredCertificate: 'rejected',
        notYetValidCertificate: 'rejected',
        corruptPfx: 'rejected',
        wrongPassphrase: 'rejected',
        configuredFallback: {
          status: configuredCertificate.status,
          commonName: configuredCertificate.commonName,
          notBefore: configuredCertificate.notBefore.toISOString(),
          notAfter: configuredCertificate.notAfter.toISOString(),
        },
      },
    },
    null,
    2
  )
);
