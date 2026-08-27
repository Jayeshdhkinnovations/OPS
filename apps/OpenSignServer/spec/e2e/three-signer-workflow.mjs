import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import forge from 'node-forge';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '../..');
const outputDir = path.join(serverDir, 'exports', 'three-signer-e2e');
process.chdir(serverDir);

process.env.APP_ID = 'opensign';
process.env.MASTER_KEY = 'three-signer-test-master-key';
process.env.PUBLIC_ORIGIN = 'https://verify.yourbrand.com';
process.env.USE_LOCAL = 'true';

function createEphemeralTestPfx() {
  const passphrase = 'isolated-e2e-test-only';
  const keyPair = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keyPair.publicKey;
  certificate.serialNumber = '26082601';
  certificate.validity.notBefore = new Date('2026-08-25T00:00:00.000Z');
  certificate.validity.notAfter = new Date('2027-08-25T00:00:00.000Z');
  const attributes = [
    { name: 'commonName', value: 'SignToowix Isolated E2E Test' },
    { name: 'organizationName', value: 'Testing Only' },
  ];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true },
  ]);
  certificate.sign(keyPair.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keyPair.privateKey, certificate, passphrase, {
    algorithm: '3des',
  });
  return {
    passphrase,
    base64: Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary').toString('base64'),
  };
}

const ephemeralPfx = createEphemeralTestPfx();
process.env.PFX_BASE64 = ephemeralPfx.base64;
process.env.PASS_PHRASE = ephemeralPfx.passphrase;

const signers = [
  {
    objectId: 'testJayesh01',
    Name: 'Jayesh Chaudhary',
    Email: 'jayesh.chaudhary@example.com',
    ipAddress: '203.0.113.10',
    viewedAt: '2026-08-26T04:32:00.000Z',
    signedAt: '2026-08-26T04:35:00.000Z',
  },
  {
    objectId: 'testPiyush02',
    Name: 'Piyush',
    Email: 'piyush@example.com',
    ipAddress: '198.51.100.25',
    viewedAt: '2026-08-26T04:40:00.000Z',
    signedAt: '2026-08-26T04:43:00.000Z',
  },
  {
    objectId: 'testSolDail03',
    Name: 'Sol Dail',
    Email: 'sol.dail@example.com',
    ipAddress: '192.0.2.45',
    viewedAt: '2026-08-26T04:48:00.000Z',
    signedAt: '2026-08-26T04:51:00.000Z',
  },
];

const createdAt = '2026-08-26T04:30:00.000Z';
const documentId = 'TESTDOC3SGN1';

const state = {
  doc: {
    objectId: documentId,
    Name: 'Three-Signer-Test-Agreement.pdf',
    SenderName: 'Test Workflow Administrator',
    SenderMail: 'workflow-admin@example.com',
    ExtUserPtr: {
      objectId: 'testOwner001',
      Name: 'Test Workflow Administrator',
      Email: 'workflow-admin@example.com',
      Company: 'YOUR BRAND - TEST ENVIRONMENT',
      Timezone: 'Asia/Kolkata',
      Is12HourTime: true,
      DateFormat: 'DD/MM/YYYY',
      DownloadFilenameFormat: 'DOCNAME_SIGNED',
    },
    Signers: signers.map(({ objectId, Name, Email }) => ({ objectId, Name, Email })),
    Placeholders: signers.map((signer, index) => ({
      signerObjId: signer.objectId,
      Role: 'signer',
      pageNumber: index === 2 ? 1 : 0,
      pos: [
        { key: `signature_${index + 1}`, type: 'signature' },
        { key: `signed_date_${index + 1}`, type: 'date' },
      ],
    })),
    AuditTrail: [],
    DocSentAt: { __type: 'Date', iso: createdAt },
    createdAt,
    SendinOrder: true,
    SendInOrderStrict: true,
    IsEnableOTP: false,
    IsCompleted: false,
    IsSendMail: false,
    NotifyOnSignatures: false,
  },
  uploads: new Map(),
  finalSignedBytes: null,
  certificateBytes: null,
};

const RealDate = globalThis.Date;
let controlledNow = new RealDate(createdAt).getTime();
class ControlledDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [controlledNow]));
  }

  static now() {
    return controlledNow;
  }
}
globalThis.Date = ControlledDate;

class TestParseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
TestParseError.OBJECT_NOT_FOUND = 101;
TestParseError.INVALID_SESSION_TOKEN = 209;
TestParseError.OPERATION_FORBIDDEN = 119;
TestParseError.VALIDATION_ERROR = 142;

class TestQuery {
  constructor(className) {
    this.className = className;
  }

  include() {
    return this;
  }

  equalTo() {
    return this;
  }

  notEqualTo() {
    return this;
  }

  async first() {
    if (this.className !== 'contracts_Document') return null;
    return {
      get: key => state.doc[key],
      toJSON: () => JSON.parse(JSON.stringify(state.doc)),
    };
  }
}

globalThis.Parse = {
  Query: TestQuery,
  Error: TestParseError,
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function shortHash(input) {
  let hash = 0;
  for (const character of String(input || '')) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const boundaryServer = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, 'http://localhost:8081');
    if (req.method === 'POST' && requestUrl.pathname.startsWith('/app/files/')) {
      const fileName = decodeURIComponent(requestUrl.pathname.slice('/app/files/'.length));
      const bytes = await readBody(req);
      state.uploads.set(fileName, bytes);
      if (fileName === 'certificate.pdf') state.certificateBytes = bytes;
      if (fileName.startsWith('signed_')) state.finalSignedBytes = bytes;
      sendJson(res, 201, {
        name: fileName,
        url: `http://localhost:8081/app/files/${encodeURIComponent(fileName)}`,
      });
      return;
    }

    if (
      req.method === 'PUT' &&
      requestUrl.pathname === `/app/classes/contracts_Document/${documentId}`
    ) {
      const update = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      Object.assign(state.doc, update);
      sendJson(res, 200, { updatedAt: new ControlledDate().toISOString() });
      return;
    }

    sendJson(res, 404, { error: 'Test boundary route not found.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function formatSignedDate(iso) {
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new RealDate(iso)) + ' IST'
  );
}

async function createUnsignedAgreement() {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const navy = rgb(0.043, 0.176, 0.353);
  const gray = rgb(0.34, 0.37, 0.41);
  const pale = rgb(0.955, 0.965, 0.98);
  const rule = rgb(0.82, 0.84, 0.87);
  const a4 = [595.28, 841.89];
  const margin = 54;
  const contentWidth = a4[0] - margin * 2;
  const pages = [pdfDoc.addPage(a4), pdfDoc.addPage(a4)];

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    page.drawText('YOUR BRAND', { x: margin, y: 788, size: 11, font: bold, color: navy });
    page.drawText('DEVELOPMENT / TEST ENVIRONMENT', {
      x: margin,
      y: 773,
      size: 7,
      font: regular,
      color: gray,
    });
    page.drawText(`Page ${index + 1} of 2`, {
      x: 493,
      y: 780,
      size: 8,
      font: regular,
      color: gray,
    });
    page.drawLine({
      start: { x: margin, y: 760 },
      end: { x: a4[0] - margin, y: 760 },
      thickness: 1,
      color: navy,
    });
    page.drawText('Three-Signer Test Agreement', {
      x: margin,
      y: 54,
      size: 7,
      font: regular,
      color: gray,
    });
    page.drawText('For Testing Purposes Only', { x: 438, y: 54, size: 7, font: bold, color: navy });
  }

  const page1 = pages[0];
  page1.drawText('Three-Signer Test Agreement', {
    x: margin,
    y: 706,
    size: 25,
    font: bold,
    color: navy,
  });
  page1.drawRectangle({
    x: margin,
    y: 654,
    width: contentWidth,
    height: 31,
    color: pale,
    borderColor: navy,
    borderWidth: 0.75,
  });
  page1.drawText('FOR TESTING PURPOSES ONLY', {
    x: 181,
    y: 665,
    size: 11,
    font: bold,
    color: navy,
  });
  page1.drawText('Agreement overview', { x: margin, y: 610, size: 12, font: bold, color: navy });
  const agreementLines = [
    'This non-production agreement validates the development document-signing workflow for three',
    'ordered participants. Each participant acknowledges that the document contains test data only',
    'and has no commercial, legal, financial, or production effect.',
  ];
  agreementLines.forEach((line, index) => {
    page1.drawText(line, { x: margin, y: 582 - index * 17, size: 10, font: regular, color: gray });
  });
  page1.drawText('Test conditions', { x: margin, y: 504, size: 12, font: bold, color: navy });
  const terms = [
    ['1.', 'The signing sequence is Jayesh Chaudhary, Piyush, then Sol Dail.'],
    ['2.', 'Each participant receives one electronic-signature field and one signed-date field.'],
    ['3.', 'The workflow reaches Completed status only after the third participant signs.'],
    [
      '4.',
      'All names, email addresses, identifiers, timestamps, and IP addresses are test fixtures.',
    ],
  ];
  terms.forEach(([number, text], index) => {
    const y = 474 - index * 34;
    page1.drawText(number, { x: margin, y, size: 9.5, font: bold, color: navy });
    page1.drawText(text, { x: margin + 23, y, size: 9.5, font: regular, color: gray });
  });
  page1.drawLine({
    start: { x: margin, y: 302 },
    end: { x: a4[0] - margin, y: 302 },
    thickness: 0.7,
    color: rule,
  });
  page1.drawText('Document ID', { x: margin, y: 278, size: 8, font: bold, color: gray });
  page1.drawText(documentId, { x: 135, y: 278, size: 8, font: regular, color: gray });
  page1.drawText('Created', { x: margin, y: 258, size: 8, font: bold, color: gray });
  page1.drawText('25 Aug 2026, 10:00:00 AM IST', {
    x: 135,
    y: 258,
    size: 8,
    font: regular,
    color: gray,
  });
  page1.drawText('This page intentionally contains no production information.', {
    x: margin,
    y: 212,
    size: 9,
    font: italic,
    color: gray,
  });

  const page2 = pages[1];
  page2.drawText('Ordered Signatures', { x: margin, y: 716, size: 19, font: bold, color: navy });
  page2.drawText('Signers must complete these fields in the numbered order shown.', {
    x: margin,
    y: 694,
    size: 9,
    font: regular,
    color: gray,
  });
  const form = pdfDoc.getForm();
  signers.forEach((signer, index) => {
    const top = 637 - index * 174;
    page2.drawText(String(index + 1).padStart(2, '0'), {
      x: margin,
      y: top + 30,
      size: 18,
      font: bold,
      color: navy,
    });
    page2.drawText(signer.Name, { x: margin + 43, y: top + 33, size: 11, font: bold, color: navy });
    page2.drawText(signer.Email, {
      x: margin + 43,
      y: top + 18,
      size: 8,
      font: regular,
      color: gray,
    });
    page2.drawLine({
      start: { x: margin, y: top + 4 },
      end: { x: a4[0] - margin, y: top + 4 },
      thickness: 0.7,
      color: rule,
    });
    page2.drawText('Electronic signature', {
      x: margin + 43,
      y: top - 18,
      size: 7.5,
      font: bold,
      color: gray,
    });
    page2.drawText('Signed date', { x: 363, y: top - 18, size: 7.5, font: bold, color: gray });

    const signature = form.createTextField(`signature_${index + 1}`);
    signature.setText('');
    signature.addToPage(page2, {
      x: margin + 43,
      y: top - 65,
      width: 260,
      height: 34,
      borderColor: rule,
      borderWidth: 0.8,
      backgroundColor: rgb(1, 1, 1),
      textColor: navy,
    });

    const signedDate = form.createTextField(`signed_date_${index + 1}`);
    signedDate.setText('');
    signedDate.addToPage(page2, {
      x: 363,
      y: top - 65,
      width: 178,
      height: 34,
      borderColor: rule,
      borderWidth: 0.8,
      backgroundColor: rgb(1, 1, 1),
      textColor: gray,
    });
  });
  form.updateFieldAppearances(regular);
  return Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
}

async function fillSignerFields(pdfBytes, signer, index) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const signatureFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const signature = form.getTextField(`signature_${index + 1}`);
  signature.setText(signer.Name);
  signature.setFontSize(15);
  signature.updateAppearances(signatureFont);
  const signedDate = form.getTextField(`signed_date_${index + 1}`);
  signedDate.setText(formatSignedDate(signer.signedAt));
  signedDate.setFontSize(8);
  signedDate.updateAppearances(regular);
  return Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
}

async function waitForCertificate(timeoutMs = 30000) {
  const started = RealDate.now();
  while (!state.certificateBytes && RealDate.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!state.certificateBytes) throw new Error('Timed out waiting for certificate generation.');
}

await fs.mkdir(outputDir, { recursive: true });
await listen(boundaryServer, 8081);

try {
  const { default: signPdf } = await import('../../cloud/parsefunction/pdf/PDF.js');
  const originalBytes = await createUnsignedAgreement();
  const originalPath = path.join(outputDir, 'Three-Signer-Test-Agreement.pdf');
  await fs.writeFile(originalPath, originalBytes);

  let workingBytes = originalBytes;
  const steps = [];
  let staleRevisionRejected = false;
  let signerImpersonationRejected = false;
  for (let index = 0; index < signers.length; index++) {
    const signer = signers[index];
    state.doc.AuditTrail.push({
      UserPtr: { __type: 'Pointer', className: 'contracts_Contactbook', objectId: signer.objectId },
      Activity: 'Viewed',
      ViewedOn: signer.viewedAt,
    });
    workingBytes = await fillSignerFields(workingBytes, signer, index);
    controlledNow = new RealDate(signer.signedAt).getTime();
    const result = await signPdf({
      params: {
        docId: documentId,
        userId: signer.objectId,
        pdfFile: workingBytes.toString('base64'),
        isCustomCompletionMail: false,
        mailProvider: '',
        signature: Buffer.from(`TEST SIGNATURE: ${signer.Name}`, 'utf8').toString('base64'),
        expectedRevision: Number(state.doc.SigningRevision || 0),
        expectedRevisionToken: state.doc.SigningRevisionToken || '',
      },
      user: {
        toJSON: () => ({ email: signer.Email }),
        get: key => (key === 'email' ? signer.Email : undefined),
      },
      headers: {
        'x-real-ip': signer.ipAddress,
        public_url: 'http://localhost:3000',
      },
    });
    steps.push({ signer: signer.Name, status: result?.status, isCompleted: state.doc.IsCompleted });

    if (index === 0) {
      const nextSigner = signers[1];
      await assert.rejects(
        () =>
          signPdf({
            params: {
              docId: documentId,
              userId: nextSigner.objectId,
              pdfFile: workingBytes.toString('base64'),
              signature: '',
              expectedRevision: 0,
              expectedRevisionToken: '',
            },
            user: {
              toJSON: () => ({ email: nextSigner.Email }),
              get: key => (key === 'email' ? nextSigner.Email : undefined),
            },
            headers: { 'x-real-ip': nextSigner.ipAddress, public_url: 'http://localhost:3000' },
          }),
        error => /changed after it was opened/.test(error.message)
      );
      staleRevisionRejected = true;

      await assert.rejects(
        () =>
          signPdf({
            params: {
              docId: documentId,
              userId: nextSigner.objectId,
              pdfFile: workingBytes.toString('base64'),
              signature: '',
              expectedRevision: state.doc.SigningRevision,
              expectedRevisionToken: state.doc.SigningRevisionToken,
            },
            user: {
              toJSON: () => ({ email: 'attacker@example.com' }),
              get: key => (key === 'email' ? 'attacker@example.com' : undefined),
            },
            headers: { 'x-real-ip': nextSigner.ipAddress, public_url: 'http://localhost:3000' },
          }),
        error => /does not match the requested document signer/.test(error.message)
      );
      signerImpersonationRejected = true;
    }
  }

  await waitForCertificate();
  const finalSignedBytes = state.finalSignedBytes;
  const certificateBytes = state.certificateBytes;
  if (!finalSignedBytes || !certificateBytes)
    throw new Error('Expected signed PDF and certificate uploads were not captured.');

  const signedPath = path.join(outputDir, 'Three-Signer-Test-Agreement-Signed.pdf');
  const certificatePath = path.join(outputDir, 'Three-Signer-Test-Agreement-Certificate.pdf');
  await fs.writeFile(signedPath, finalSignedBytes);
  await fs.writeFile(certificatePath, certificateBytes);

  const signedPdf = await PDFDocument.load(finalSignedBytes);
  const certificatePdf = await PDFDocument.load(certificateBytes);
  const completionTime = signers.at(-1).signedAt;
  const dateKey = completionTime.slice(0, 10);
  const transactionId = `TXN-${dateKey}-${shortHash(documentId + 'txn')}`;
  const certificateId = `CERT-${dateKey}-${shortHash(documentId + completionTime)}`;
  const result = {
    test: 'Three-signer end-to-end signing and certificate workflow',
    environment:
      'Isolated development/test fixture using production signPdf and GenerateCertificate implementations',
    passed: Boolean(
      state.doc.IsCompleted &&
      staleRevisionRejected &&
      signerImpersonationRejected &&
      state.doc.AuditTrail.filter(entry => entry.Activity === 'Signed').length === 3 &&
      state.doc.DocumentHash === sha256(finalSignedBytes) &&
      state.doc.TransactionId === transactionId &&
      state.doc.CertificateId === certificateId &&
      Boolean(state.doc.VerificationEvidenceRoot) &&
      signedPdf.catalog.has(PDFName.of('SignToowixVerificationEvidence')) &&
      signedPdf.catalog.has(PDFName.of('Perms')) &&
      signedPdf.getPageCount() === 2 &&
      certificatePdf.getPageCount() === 1
    ),
    documentId,
    transactionId,
    certificateId,
    documentName: state.doc.Name,
    signingOrder: signers.map(({ Name, Email, ipAddress, viewedAt, signedAt }) => ({
      Name,
      Email,
      ipAddress,
      viewedAt,
      signedAt,
    })),
    workflowSteps: steps,
    staleRevisionRejected,
    signerImpersonationRejected,
    finalStatus: state.doc.IsCompleted ? 'Completed' : 'Not completed',
    pageCounts: {
      original: 2,
      signed: signedPdf.getPageCount(),
      certificate: certificatePdf.getPageCount(),
    },
    documentHash: state.doc.DocumentHash,
    calculatedDocumentHash: sha256(finalSignedBytes),
    finalDocumentDigitallySigned: finalSignedBytes.includes(Buffer.from('/ByteRange')),
    certificateDigitallySigned: certificateBytes.includes(Buffer.from('/ByteRange')),
    protectedVerificationEvidence: signedPdf.catalog.has(
      PDFName.of('SignToowixVerificationEvidence')
    ),
    docMdpPermissionPolicy: signedPdf.catalog.has(PDFName.of('Perms')),
    auditEvidenceRoot: state.doc.VerificationEvidenceRoot,
    outputs: { originalPath, signedPath, certificatePath },
  };
  const jsonPath = path.join(outputDir, 'three-signer-test-result.json');
  const summaryPath = path.join(outputDir, 'three-signer-test-result.txt');
  await fs.writeFile(jsonPath, JSON.stringify(result, null, 2));
  await fs.writeFile(
    summaryPath,
    [
      `RESULT: ${result.passed ? 'PASSED' : 'FAILED'}`,
      `Workflow: ${result.test}`,
      `Final status: ${result.finalStatus}`,
      `Document ID: ${documentId}`,
      `Transaction ID: ${transactionId}`,
      `Certificate ID: ${certificateId}`,
      `Signing order: ${signers.map(signer => signer.Name).join(' -> ')}`,
      `Pages: original ${result.pageCounts.original}, signed ${result.pageCounts.signed}, certificate ${result.pageCounts.certificate}`,
      `Document SHA-256: ${result.documentHash}`,
      `Final document digitally signed: ${result.finalDocumentDigitallySigned}`,
      `Certificate digitally signed: ${result.certificateDigitallySigned}`,
      `Protected verification evidence: ${result.protectedVerificationEvidence}`,
      `DocMDP permission policy: ${result.docMdpPermissionPolicy}`,
      `Audit evidence root: ${result.auditEvidenceRoot}`,
      '',
      'The local fixture invoked the repository production signPdf function for each signer,',
      'including strict-order enforcement, completion detection, digital signing, and the',
      'existing GenerateCertificate implementation. Only Parse persistence/file storage were',
      'replaced by an isolated in-memory localhost boundary; no production system was contacted.',
    ].join('\n')
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  globalThis.Date = RealDate;
  await close(boundaryServer);
}
