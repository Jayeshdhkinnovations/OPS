import assert from 'node:assert/strict';
import forge from 'node-forge';
import * as asn1js from 'asn1js';
import {
  BasicOCSPResponse,
  Certificate,
  ContentInfo,
  EncapsulatedContentInfo,
  IssuerAndSerialNumber,
  OCSPResponse,
  PKIStatus,
  PKIStatusInfo,
  ResponseBytes,
  SignedData,
  SignerInfo,
  SingleResponse,
  TSTInfo,
  TimeStampReq,
  TimeStampResp,
  CertID,
} from 'pkijs';
import {
  CERTIFICATE_TRUST_STATUS,
  evaluateCertificateTrust,
  parseTrustedCertificates,
  verifyProtectedEvidence,
} from '../../OpenSign/src/utils/pdfSignatureVerification.mjs';
import {
  checkOcsp,
  requestRfc3161Timestamp,
  validateExternalCertificateUrl,
} from '../cloud/parsefunction/pdf/ExternalCertificateValidation.js';
import { buildVerificationEvidence } from '../cloud/parsefunction/pdf/VerificationEvidence.js';

function forgeToPkijs(certificate) {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const bytes = Buffer.from(der, 'binary');
  const parsed = asn1js.fromBER(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
  return new Certificate({ schema: parsed.result });
}

function forgeToClientPkijs(certificate) {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const base64 = Buffer.from(der, 'binary').toString('base64');
  return parseTrustedCertificates(JSON.stringify([base64]))[0];
}

function createCertificate({ subject, issuerCertificate, issuerKey, isCa, eku }) {
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
  const extensions = [
    { name: 'basicConstraints', cA: isCa },
    isCa
      ? { name: 'keyUsage', keyCertSign: true, cRLSign: true }
      : { name: 'keyUsage', digitalSignature: true },
  ];
  if (eku) extensions.push({ name: 'extKeyUsage', [eku]: true });
  certificate.setExtensions(extensions);
  certificate.sign(issuerKey || keys.privateKey, forge.md.sha256.create());
  return {
    certificate,
    keys,
    pkijs: forgeToPkijs(certificate),
    clientPkijs: forgeToClientPkijs(certificate),
  };
}

function importPrivateKey(privateKey) {
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

const root = createCertificate({ subject: 'Phase 2 Test Root', isCa: true });
const leaf = createCertificate({
  subject: 'Phase 2 Document Signer',
  issuerCertificate: root.certificate,
  issuerKey: root.keys.privateKey,
  isCa: false,
});

const trusted = await evaluateCertificateTrust({
  signerCertificate: leaf.clientPkijs,
  embeddedCertificates: [leaf.clientPkijs, root.clientPkijs],
  trustedCertificates: [root.clientPkijs],
  verificationTime: new Date('2026-08-26T00:00:00.000Z'),
});
assert.equal(trusted.status, CERTIFICATE_TRUST_STATUS.TRUSTED);

const untrusted = await evaluateCertificateTrust({
  signerCertificate: leaf.clientPkijs,
  embeddedCertificates: [leaf.clientPkijs, root.clientPkijs],
  verificationTime: new Date('2026-08-26T00:00:00.000Z'),
});
assert.equal(untrusted.status, CERTIFICATE_TRUST_STATUS.CHAIN_VALID_UNTRUSTED_ROOT);

const protectedManifest = buildVerificationEvidence({
  document: {
    objectId: 'PHASE2DOC1',
    Name: 'Phase-2-Test.pdf',
    IsEnableOTP: true,
    Signers: [{ objectId: 'signer1', Name: 'Test Signer', Email: 'signer@example.com' }],
    Placeholders: [{ pageNumber: 0 }],
  },
  auditTrail: [
    {
      UserPtr: { objectId: 'signer1' },
      Activity: 'Signed',
      SignedOn: '2026-08-26T04:35:00.000Z',
      ipAddress: '203.0.113.10',
      Authentication: {
        method: 'email_otp',
        result: 'session_verified',
        verifiedAt: '2026-08-26T04:34:30.000Z',
      },
    },
  ],
  completedAt: '2026-08-26T04:35:00.000Z',
});
const protectedResult = await verifyProtectedEvidence(protectedManifest);
assert.equal(protectedResult.auditTrailIntegrityStatus, 'pass');
assert.equal(protectedResult.signerAuthenticationStatus, 'verified');
assert.equal(protectedResult.identifierProtectionStatus, 'pass');
const alteredManifest = structuredClone(protectedManifest);
alteredManifest.events[0].ipAddress = '198.51.100.99';
assert.equal((await verifyProtectedEvidence(alteredManifest)).auditTrailIntegrityStatus, 'fail');

const mockPublicResolver = async () => [{ address: '93.184.216.34', family: 4 }];
const mockPrivateResolver = async () => [{ address: '127.0.0.1', family: 4 }];
await validateExternalCertificateUrl('https://tsa.example.test', mockPublicResolver);
await assert.rejects(
  validateExternalCertificateUrl('http://localhost/ocsp', mockPrivateResolver),
  /blocked network address/
);

const tsa = createCertificate({ subject: 'Phase 2 Test TSA', isCa: false, eku: 'timeStamping' });
const tsaPrivateKey = await importPrivateKey(tsa.keys.privateKey);
const timestampData = new TextEncoder().encode('phase-2-timestamp-evidence');
const timestampFetch = async (_url, options) => {
  const requestBytes = new Uint8Array(options.body);
  const requestAsn1 = asn1js.fromBER(
    requestBytes.buffer.slice(
      requestBytes.byteOffset,
      requestBytes.byteOffset + requestBytes.byteLength
    )
  );
  const request = new TimeStampReq({ schema: requestAsn1.result });
  const tstInfo = new TSTInfo({
    version: 1,
    policy: '1.3.6.1.4.1.55555.1',
    messageImprint: request.messageImprint,
    serialNumber: new asn1js.Integer({ value: 1 }),
    genTime: new Date('2026-08-26T05:00:00.000Z'),
    nonce: request.nonce,
  });
  const tstInfoRaw = tstInfo.toSchema().toBER(false);
  TSTInfo.fromBER(tstInfoRaw);
  const signedData = new SignedData({
    version: 3,
    encapContentInfo: new EncapsulatedContentInfo({
      eContentType: '1.2.840.113549.1.9.16.1.4',
      eContent: new asn1js.OctetString({ valueHex: tstInfoRaw }),
    }),
    signerInfos: [
      new SignerInfo({
        version: 1,
        sid: new IssuerAndSerialNumber({
          issuer: tsa.pkijs.issuer,
          serialNumber: tsa.pkijs.serialNumber,
        }),
      }),
    ],
    certificates: [tsa.pkijs],
  });
  await signedData.sign(tsaPrivateKey, 0, 'SHA-256');
  signedData.encapContentInfo.eContent = new asn1js.OctetString({ valueHex: tstInfoRaw });
  const content = new ContentInfo({
    contentType: ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(true),
  });
  assert.equal(signedData.signerInfos.length, 1);
  const reparsedSignedData = new SignedData({ schema: content.content });
  assert.equal(reparsedSignedData.signerInfos.length, 1);
  TSTInfo.fromBER(reparsedSignedData.encapContentInfo.eContent.valueBlock.valueHexView);
  const response = new TimeStampResp({
    status: new PKIStatusInfo({ status: PKIStatus.granted }),
    timeStampToken: new ContentInfo({ schema: content.toSchema() }),
  });
  return new Response(response.toSchema().toBER(false), {
    status: 200,
    headers: { 'Content-Type': 'application/timestamp-reply' },
  });
};

const timestamp = await requestRfc3161Timestamp({
  url: 'https://tsa.example.test',
  data: timestampData,
  trustedCerts: [tsa.pkijs],
  resolver: mockPublicResolver,
  fetchImpl: timestampFetch,
});
assert.equal(timestamp.status, 'trusted');

const issuerPrivateKey = await importPrivateKey(root.keys.privateKey);
const ocspFetch = async () => {
  const certID = new CertID();
  await certID.createForCertificate(leaf.pkijs, {
    hashAlgorithm: 'SHA-256',
    issuerCertificate: root.pkijs,
  });
  const single = new SingleResponse({ certID });
  single.certStatus = new asn1js.Primitive({
    idBlock: { tagClass: 3, tagNumber: 0 },
    lenBlockLength: 1,
  });
  single.thisUpdate = new Date('2026-08-26T05:00:00.000Z');
  const basic = new BasicOCSPResponse();
  basic.tbsResponseData.responderID = root.pkijs.subject;
  basic.tbsResponseData.producedAt = new Date('2026-08-26T05:00:00.000Z');
  basic.tbsResponseData.responses.push(single);
  basic.certs = [root.pkijs];
  await basic.sign(issuerPrivateKey, 'SHA-256');
  const raw = basic.toSchema().toBER(false);
  const response = new OCSPResponse({
    responseStatus: new asn1js.Enumerated({ value: 0 }),
    responseBytes: new ResponseBytes({
      responseType: '1.3.6.1.5.5.7.48.1.1',
      response: new asn1js.OctetString({ valueHex: raw }),
    }),
  });
  return new Response(response.toSchema().toBER(false), { status: 200 });
};

const ocsp = await checkOcsp({
  url: 'https://ocsp.example.test',
  certificate: leaf.pkijs,
  issuerCertificate: root.pkijs,
  trustedCerts: [root.pkijs],
  resolver: mockPublicResolver,
  fetchImpl: ocspFetch,
});
assert.equal(ocsp.status, 'good');

console.log(
  JSON.stringify(
    {
      passed: true,
      tests: {
        configuredTrustAnchor: trusted.status,
        structurallyValidUntrustedChain: untrusted.status,
        protectedAuditManifest: protectedResult.auditTrailIntegrityStatus,
        signerAuthentication: protectedResult.signerAuthenticationStatus,
        protectedIdentifiers: protectedResult.identifierProtectionStatus,
        alteredAuditManifest: 'detected',
        ssrfPrivateAddress: 'blocked',
        rfc3161Timestamp: timestamp.status,
        ocsp: ocsp.status,
      },
    },
    null,
    2
  )
);
