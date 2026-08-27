import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { P12Signer } from '@signpdf/signer-p12';
import { SignPdf } from '@signpdf/signpdf';
import {
  CHECK_STATUS,
  verifyPdfSignatures,
} from '../../OpenSign/src/utils/pdfSignatureVerification.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(scriptDir, '../exports/three-signer-e2e');
const outputPath = path.join(outputDir, 'Expired-Certificate-Signed.pdf');
const passphrase = 'isolated-expired-fixture-only';

function createExpiredPfx() {
  const keyPair = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keyPair.publicKey;
  certificate.serialNumber = '25010101';
  certificate.validity.notBefore = new Date('2023-01-01T00:00:00.000Z');
  certificate.validity.notAfter = new Date('2024-01-01T00:00:00.000Z');
  const attributes = [
    { name: 'commonName', value: 'Expired Verification Test Certificate' },
    { name: 'organizationName', value: 'Testing Only' },
  ];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true },
  ]);
  certificate.sign(keyPair.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keyPair.privateKey, certificate, passphrase, {
    algorithm: '3des',
  });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

const pdf = await PDFDocument.create();
const page = pdf.addPage([595.28, 841.89]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText('Expired certificate verification fixture — testing only', {
  x: 54,
  y: 760,
  size: 14,
  font,
});
pdflibAddPlaceholder({
  pdfDoc: pdf,
  reason: 'Deterministic expired-certificate verification test',
  name: 'Expired Verification Test Certificate',
  location: 'Test environment',
  contactInfo: 'testing@example.invalid',
  signatureLength: 12000,
});
const bytesWithPlaceholder = Buffer.from(await pdf.save({ useObjectStreams: false }));
const signedBytes = await new SignPdf().sign(
  bytesWithPlaceholder,
  new P12Signer(createExpiredPfx(), { passphrase })
);

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputPath, signedBytes);
const verification = await verifyPdfSignatures(new Uint8Array(signedBytes));
assert.equal(verification.error, undefined);
assert.equal(verification.results.length, 1);
const result = verification.results[0];
assert.equal(result.documentIntegrityStatus, CHECK_STATUS.PASS);
assert.equal(result.cryptographicSignatureStatus, CHECK_STATUS.PASS);
assert.equal(result.certificateStatus, 'expired');
assert.equal(result.overallStatus, CHECK_STATUS.WARNING);

console.log(
  JSON.stringify(
    {
      passed: true,
      outputPath,
      documentIntegrity: result.documentIntegrityStatus,
      cryptographicSignature: result.cryptographicSignatureStatus,
      certificateStatus: result.certificateStatus,
      overallStatus: result.overallStatus,
    },
    null,
    2
  )
);
