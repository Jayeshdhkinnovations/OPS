import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFSignature,
  PDFString
} from "pdf-lib";
import * as asn1js from "asn1js";
import {
  Certificate,
  CertificateChainValidationEngine,
  ContentInfo,
  IssuerAndSerialNumber,
  SignedData,
  TimeStampResp
} from "pkijs";

export const CHECK_STATUS = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  WARNING: "warning",
  ERROR: "error",
  UNKNOWN: "unknown"
});

export const CERTIFICATE_TRUST_STATUS = Object.freeze({
  TRUSTED: "trusted",
  SELF_SIGNED: "self_signed",
  CHAIN_VALID_UNTRUSTED_ROOT: "chain_valid_untrusted_root",
  CHAIN_ERROR: "chain_error",
  UNKNOWN: CHECK_STATUS.UNKNOWN
});

const MESSAGE_DIGEST_OID = "1.2.840.113549.1.9.4";
const VERIFICATION_EVIDENCE_KEY = "SignToowixVerificationEvidence";
const DIGEST_ALGORITHMS = Object.freeze({
  "1.3.14.3.2.26": "SHA-1",
  "2.16.840.1.101.3.4.2.1": "SHA-256",
  "2.16.840.1.101.3.4.2.2": "SHA-384",
  "2.16.840.1.101.3.4.2.3": "SHA-512"
});

function base64Bytes(value) {
  const normalized = value.replace(/\s+/g, "");
  if (typeof Buffer !== "undefined")
    return new Uint8Array(Buffer.from(normalized, "base64"));
  const binary = globalThis.atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function parseTrustedCertificates(configuration) {
  if (!configuration) return [];
  const text = String(configuration).trim();
  let entries;
  try {
    const parsed = JSON.parse(text);
    entries = Array.isArray(parsed) ? parsed : [text];
  } catch {
    const pemEntries = [
      ...text.matchAll(
        /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g
      )
    ].map((match) => match[1]);
    entries = pemEntries.length
      ? pemEntries
      : text.split(/[;,]/).filter(Boolean);
  }
  return entries.map((entry) => {
    const bytes = base64Bytes(String(entry).replace(/-----[^-]+-----/g, ""));
    const parsed = asn1js.fromBER(exactArrayBuffer(bytes));
    if (parsed.offset === -1)
      throw new Error("A configured trust anchor is not valid DER.");
    return new Certificate({ schema: parsed.result });
  });
}

function exactBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(
      input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
    );
  }
  throw new TypeError("PDF input must be an ArrayBuffer or typed-array view.");
}

function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

function toHex(bytes) {
  return Array.from(bytes || [], (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined")
    return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function certificateDerBase64(certificate) {
  return certificate
    ? bytesToBase64(new Uint8Array(certificate.toSchema(true).toBER(false)))
    : "";
}

function certificateServiceUrls(certificate) {
  const urls = { ocsp: [], crl: [] };
  for (const extension of certificate?.extensions || []) {
    if (extension.extnID === "1.3.6.1.5.5.7.1.1") {
      for (const description of extension.parsedValue?.accessDescriptions ||
        []) {
        if (description.accessMethod === "1.3.6.1.5.5.7.48.1") {
          const value = description.accessLocation?.value;
          if (typeof value === "string") urls.ocsp.push(value);
        }
      }
    }
    if (extension.extnID === "2.5.29.31") {
      for (const point of extension.parsedValue?.distributionPoints || []) {
        for (const name of point.distributionPoint || []) {
          if (typeof name?.value === "string") urls.crl.push(name.value);
        }
      }
    }
  }
  return urls;
}

function equalBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left[index] ^ right[index];
  return difference === 0;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

async function sha256Text(value) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return toHex(new Uint8Array(digest));
}

function decodeBase64Utf8(value) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf8");
  }
  const binary = globalThis.atob(value);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0))
  );
}

function extractVerificationEvidence(pdfDoc) {
  const value = pdfDoc.catalog.get(PDFName.of(VERIFICATION_EVIDENCE_KEY));
  if (!(value instanceof PDFString) && !(value instanceof PDFHexString))
    return null;
  try {
    return JSON.parse(decodeBase64Utf8(value.decodeText()));
  } catch {
    return { malformed: true };
  }
}

function shortHash(input) {
  let hash = 0;
  for (const character of String(input || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

async function verifyEmbeddedTimestamp(evidence, trustedCertificates) {
  if (!evidence?.timestamp?.token)
    return evidence?.timestamp?.status || "unavailable";
  try {
    const responseBytes = base64Bytes(evidence.timestamp.token);
    const parsed = asn1js.fromBER(exactArrayBuffer(responseBytes));
    if (parsed.offset === -1) return "invalid";
    const response = new TimeStampResp({ schema: parsed.result });
    const data = Uint8Array.from(evidence.auditRoot.match(/.{2}/g), (pair) =>
      Number.parseInt(pair, 16)
    );
    const valid = await response.verify({
      signer: 0,
      data: exactArrayBuffer(data),
      trustedCerts: trustedCertificates
    });
    if (!valid) return "invalid";
    return trustedCertificates.length ? "trusted" : "valid_untrusted_tsa";
  } catch {
    return "invalid";
  }
}

export async function verifyProtectedEvidence(
  evidence,
  tsaTrustedCertificates = []
) {
  if (!evidence) {
    return {
      auditTrailIntegrityStatus: "unavailable",
      signerAuthenticationStatus: "unavailable",
      identifierProtectionStatus: "unavailable",
      trustedTimestampStatus: "unavailable",
      verificationEvidence: null
    };
  }
  if (
    evidence.malformed ||
    evidence.version !== 1 ||
    !Array.isArray(evidence.events)
  ) {
    return {
      auditTrailIntegrityStatus: CHECK_STATUS.FAIL,
      signerAuthenticationStatus: "inconsistent",
      identifierProtectionStatus: CHECK_STATUS.FAIL,
      trustedTimestampStatus: "invalid",
      verificationEvidence: evidence
    };
  }

  let previousHash = "0".repeat(64);
  let eventsValid = true;
  for (const event of evidence.events) {
    const { hash, ...protectedEvent } = event;
    if (protectedEvent.previousHash !== previousHash) eventsValid = false;
    const calculatedHash = await sha256Text(stableStringify(protectedEvent));
    if (calculatedHash !== hash) eventsValid = false;
    previousHash = hash;
  }
  if (
    evidence.auditRoot !==
    (evidence.events.at(-1)?.hash || (await sha256Text("")))
  ) {
    eventsValid = false;
  }
  const { manifestHash, ...manifest } = evidence;
  if ((await sha256Text(stableStringify(manifest))) !== manifestHash)
    eventsValid = false;

  const participants = Array.isArray(evidence.participants)
    ? evidence.participants
    : [];
  const signedParticipants = participants.filter(
    (participant) => participant.signedAt
  );
  let signerAuthenticationStatus = "unavailable";
  if (
    participants.length &&
    signedParticipants.length !== participants.length
  ) {
    signerAuthenticationStatus = "inconsistent";
  } else if (participants.length) {
    const allSessionVerified = participants.every((participant) =>
      ["session_verified", "authenticated_email_match"].includes(
        participant.authentication?.result
      )
    );
    const allHaveEvidence = participants.every((participant) =>
      ["session_verified", "authenticated_email_match", "link_access"].includes(
        participant.authentication?.result
      )
    );
    signerAuthenticationStatus = allSessionVerified
      ? "verified"
      : allHaveEvidence
        ? "partially_verified"
        : "inconsistent";
  }

  const document = evidence.document || {};
  const completionTime = String(document.completionTime || "");
  const dateKey = completionTime.slice(0, 10);
  const expectedTransactionId = `TXN-${dateKey}-${shortHash(document.documentId + "txn")}`;
  const expectedCertificateId = `CERT-${dateKey}-${shortHash(document.documentId + completionTime)}`;
  const identifiersValid =
    Boolean(document.documentId && completionTime) &&
    document.transactionId === expectedTransactionId &&
    document.certificateId === expectedCertificateId;

  return {
    auditTrailIntegrityStatus: eventsValid
      ? CHECK_STATUS.PASS
      : CHECK_STATUS.FAIL,
    signerAuthenticationStatus,
    identifierProtectionStatus: identifiersValid
      ? CHECK_STATUS.PASS
      : CHECK_STATUS.FAIL,
    trustedTimestampStatus: await verifyEmbeddedTimestamp(
      evidence,
      tsaTrustedCertificates
    ),
    verificationEvidence: evidence
  };
}

function certificateName(name) {
  return name.typesAndValues
    .map((entry) => `${entry.type}=${entry.value.valueBlock.value}`)
    .join(", ");
}

function normalizedName(name) {
  return name.typesAndValues
    .map((entry) => `${entry.type}=${String(entry.value.valueBlock.value)}`)
    .join("|");
}

function serialHex(serialNumber) {
  return toHex(serialNumber?.valueBlock?.valueHexView);
}

function certificateIdentity(certificate) {
  return `${normalizedName(certificate.subject)}|${serialHex(certificate.serialNumber)}`;
}

function uniqueCertificates(certificates) {
  const seen = new Set();
  return certificates.filter((certificate) => {
    if (!(certificate instanceof Certificate)) return false;
    const identity = certificateIdentity(certificate);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function isSelfIssued(certificate) {
  return (
    normalizedName(certificate.subject) === normalizedName(certificate.issuer)
  );
}

async function validateChain({
  signerCertificate,
  certificates,
  trustedCerts,
  checkDate
}) {
  try {
    const engine = new CertificateChainValidationEngine({
      trustedCerts,
      certs: uniqueCertificates([signerCertificate, ...certificates]),
      checkDate
    });
    return await engine.verify({ passedWhenNotRevValues: true });
  } catch (error) {
    return {
      result: false,
      resultMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function evaluateCertificateTrust({
  signerCertificate,
  embeddedCertificates = [],
  trustedCertificates = [],
  verificationTime = new Date()
}) {
  if (!(signerCertificate instanceof Certificate)) {
    return {
      status: CERTIFICATE_TRUST_STATUS.UNKNOWN,
      detail: "The signer certificate was not available for trust validation."
    };
  }

  const checkDate =
    verificationTime instanceof Date
      ? verificationTime
      : new Date(verificationTime);
  if (Number.isNaN(checkDate.getTime())) {
    throw new Error("Invalid certificate trust verification time.");
  }

  const embedded = uniqueCertificates(embeddedCertificates);
  const trusted = uniqueCertificates(trustedCertificates);
  if (trusted.length) {
    const trustedResult = await validateChain({
      signerCertificate,
      certificates: embedded,
      trustedCerts: trusted,
      checkDate
    });
    if (trustedResult.result) {
      return {
        status: CERTIFICATE_TRUST_STATUS.TRUSTED,
        detail: "The certificate chain terminates at a configured trust anchor."
      };
    }
  }

  if (isSelfIssued(signerCertificate)) {
    let signatureValid = false;
    try {
      signatureValid = await signerCertificate.verify(signerCertificate);
    } catch {
      signatureValid = false;
    }
    return signatureValid
      ? {
          status: CERTIFICATE_TRUST_STATUS.SELF_SIGNED,
          detail:
            "The certificate is self-signed. Its signature is mathematically valid but no external trust anchor was configured."
        }
      : {
          status: CERTIFICATE_TRUST_STATUS.CHAIN_ERROR,
          detail: "The self-issued certificate signature could not be verified."
        };
  }

  const untrustedRoots = embedded.filter(
    (certificate) =>
      isSelfIssued(certificate) &&
      certificateIdentity(certificate) !==
        certificateIdentity(signerCertificate)
  );
  for (const root of untrustedRoots) {
    const structuralResult = await validateChain({
      signerCertificate,
      certificates: embedded.filter(
        (certificate) =>
          certificateIdentity(certificate) !== certificateIdentity(root)
      ),
      trustedCerts: [root],
      checkDate
    });
    if (structuralResult.result) {
      return {
        status: CERTIFICATE_TRUST_STATUS.CHAIN_VALID_UNTRUSTED_ROOT,
        detail:
          "The embedded certificate chain is structurally valid, but its root is not in the configured trust store."
      };
    }
  }

  return {
    status: CERTIFICATE_TRUST_STATUS.CHAIN_ERROR,
    detail:
      trusted.length > 0
        ? "The certificate chain could not be validated against the configured trust anchors."
        : "The certificate issuer chain is incomplete or no matching trust anchor is configured."
  };
}

function findSignerCertificate(signedData, signerInfo) {
  const certificates = (signedData.certificates || []).filter(
    (certificate) => certificate instanceof Certificate
  );
  if (!certificates.length) return null;

  if (signerInfo.sid instanceof IssuerAndSerialNumber) {
    const expectedSerial = serialHex(signerInfo.sid.serialNumber);
    const expectedIssuer = normalizedName(signerInfo.sid.issuer);
    const exactMatch = certificates.find(
      (certificate) =>
        serialHex(certificate.serialNumber) === expectedSerial &&
        normalizedName(certificate.issuer) === expectedIssuer
    );
    if (exactMatch) return exactMatch;

    // Some producers encode equivalent distinguished names in a different
    // order. Serial numbers are unique per issuer, so this remains a safer
    // fallback than silently selecting the first embedded certificate.
    const serialMatch = certificates.find(
      (certificate) => serialHex(certificate.serialNumber) === expectedSerial
    );
    if (serialMatch) return serialMatch;
  }

  return certificates.length === 1 ? certificates[0] : null;
}

function getSignatureDictionary(pdfDoc, field) {
  const value = field.acroField?.dict?.get(PDFName.of("V"));
  if (value instanceof PDFRef) {
    const resolved = pdfDoc.context.lookup(value);
    return resolved instanceof PDFDict ? resolved : null;
  }
  return value instanceof PDFDict ? value : null;
}

function resolveObject(pdfDoc, value) {
  return value instanceof PDFRef ? pdfDoc.context.lookup(value) : value;
}

function docMdpPermission(pdfDoc, signatureDictionary) {
  const references = resolveObject(
    pdfDoc,
    signatureDictionary.get(PDFName.of("Reference"))
  );
  if (!(references instanceof PDFArray)) return null;
  for (const item of references.asArray()) {
    const reference = resolveObject(pdfDoc, item);
    if (!(reference instanceof PDFDict)) continue;
    const method = reference.get(PDFName.of("TransformMethod"));
    if (method?.decodeText?.() !== "DocMDP") continue;
    const params = resolveObject(
      pdfDoc,
      reference.get(PDFName.of("TransformParams"))
    );
    const permission =
      params instanceof PDFDict ? params.get(PDFName.of("P")) : null;
    return permission?.asNumber?.() || null;
  }
  return null;
}

function parseByteRange(signatureDictionary, fileLength) {
  const byteRangeObject = signatureDictionary.get(PDFName.of("ByteRange"));
  if (
    !byteRangeObject?.array ||
    !Array.isArray(byteRangeObject.array) ||
    byteRangeObject.array.length < 4 ||
    byteRangeObject.array.length % 2 !== 0
  ) {
    throw new Error("The PDF signature has a missing or malformed ByteRange.");
  }

  const byteRange = byteRangeObject.array.map((value) => {
    if (!value || typeof value.asNumber !== "function") {
      throw new Error(
        "The PDF signature ByteRange contains a non-numeric value."
      );
    }
    return value.asNumber();
  });

  let previousEnd = -1;
  for (let index = 0; index < byteRange.length; index += 2) {
    const start = byteRange[index];
    const length = byteRange[index + 1];
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length <= 0
    ) {
      throw new Error(
        "The PDF signature ByteRange contains an invalid offset or length."
      );
    }
    if (index === 0 && start !== 0) {
      throw new Error(
        "The PDF signature ByteRange does not begin at the start of the file."
      );
    }
    if (start < previousEnd || start + length > fileLength) {
      throw new Error(
        "The PDF signature ByteRange overlaps or extends beyond the file."
      );
    }
    previousEnd = start + length;
  }

  return {
    byteRange,
    signedRevisionLength: previousEnd,
    coversWholeFile: previousEnd === fileLength
  };
}

function reconstructSignedBytes(fileBytes, byteRange) {
  const totalLength = byteRange
    .filter((_, index) => index % 2 === 1)
    .reduce((total, length) => total + length, 0);
  const signedBytes = new Uint8Array(totalLength);
  let destinationOffset = 0;

  for (let index = 0; index < byteRange.length; index += 2) {
    const start = byteRange[index];
    const length = byteRange[index + 1];
    signedBytes.set(
      fileBytes.subarray(start, start + length),
      destinationOffset
    );
    destinationOffset += length;
  }
  return signedBytes;
}

function parseCms(signatureDictionary) {
  const contents = signatureDictionary.get(PDFName.of("Contents"));
  if (!contents || typeof contents.asString !== "function") {
    throw new Error("The PDF signature does not contain CMS signature data.");
  }

  const hex = contents.asString().replace(/\s+/g, "");
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(
      "The PDF signature CMS contents are not valid hexadecimal data."
    );
  }

  const cmsBytes = Uint8Array.from(hex.match(/.{2}/g), (pair) =>
    Number.parseInt(pair, 16)
  );
  const asn1 = asn1js.fromBER(exactArrayBuffer(cmsBytes));
  if (asn1.offset === -1)
    throw new Error("The CMS signature data could not be parsed.");

  const contentInfo = new ContentInfo({ schema: asn1.result });
  if (String(contentInfo.contentType) !== String(ContentInfo.SIGNED_DATA)) {
    throw new Error("The PDF signature is not CMS SignedData.");
  }
  return new SignedData({ schema: contentInfo.content });
}

function messageDigestFromSignerInfo(signerInfo) {
  const attribute = signerInfo.signedAttrs?.attributes?.find(
    (candidate) => candidate.type === MESSAGE_DIGEST_OID
  );
  const value = attribute?.values?.[0]?.valueBlock?.valueHexView;
  return value ? new Uint8Array(value) : null;
}

function certificateDateStatus(certificate, verificationTime) {
  if (!certificate) return CHECK_STATUS.UNKNOWN;
  if (verificationTime < certificate.notBefore.value) return "not_yet_valid";
  if (verificationTime > certificate.notAfter.value) return "expired";
  return CHECK_STATUS.PASS;
}

function errorResult(name, error) {
  return {
    name,
    status: "Verification error",
    overallStatus: CHECK_STATUS.ERROR,
    documentIntegrityStatus: CHECK_STATUS.ERROR,
    cryptographicSignatureStatus: CHECK_STATUS.ERROR,
    certificateStatus: CHECK_STATUS.UNKNOWN,
    certificateTrustStatus: CERTIFICATE_TRUST_STATUS.UNKNOWN,
    certificateTrustDetail: "Certificate trust was not checked.",
    trustedTimestampStatus: "unavailable",
    revocationStatus: "unavailable",
    signerAuthenticationStatus: "unavailable",
    auditTrailIntegrityStatus: "unavailable",
    identifierProtectionStatus: "unavailable",
    revisionPermissionsStatus: CHECK_STATUS.UNKNOWN,
    certificateSubject: "",
    certificateIssuer: "",
    certificateValidity: "Certificate validity was not checked",
    calculatedDocumentHash: "",
    messageDigestInSignature: "",
    hashComparisonResult: "Not performed",
    authenticatedAttributesSignatureResult: "Not performed",
    errorDetails: error instanceof Error ? error.message : String(error)
  };
}

async function verifyDescriptor(
  descriptor,
  fileBytes,
  verificationTime,
  latestRevisionLength,
  trustedCertificates
) {
  const {
    fieldName,
    signedData,
    signedBytes,
    byteRange,
    signedRevisionLength,
    coversWholeFile
  } = descriptor;
  const signerInfo = signedData.signerInfos?.[0];
  if (!signerInfo)
    throw new Error("The CMS signature does not contain signer information.");

  const digestAlgorithm =
    DIGEST_ALGORITHMS[signerInfo.digestAlgorithm?.algorithmId];
  if (!digestAlgorithm) {
    throw new Error(
      `Unsupported CMS digest algorithm: ${signerInfo.digestAlgorithm?.algorithmId || "unknown"}.`
    );
  }
  if (!globalThis.crypto?.subtle)
    throw new Error("Web Crypto is unavailable in this environment.");

  const calculatedDigest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      digestAlgorithm,
      exactArrayBuffer(signedBytes)
    )
  );
  const embeddedDigest = messageDigestFromSignerInfo(signerInfo);
  const digestMatches = equalBytes(calculatedDigest, embeddedDigest);
  const isLatestRevision = signedRevisionLength === latestRevisionLength;
  const unsignedTrailingBytes = isLatestRevision && !coversWholeFile;
  const revisionPermissionsStatus = unsignedTrailingBytes
    ? "unauthorized_change"
    : descriptor.docMdpPermission === 1 && coversWholeFile
      ? "permitted"
      : descriptor.docMdpPermission
        ? CHECK_STATUS.UNKNOWN
        : "not_applicable";
  const documentIntegrityStatus =
    digestMatches && !unsignedTrailingBytes
      ? CHECK_STATUS.PASS
      : CHECK_STATUS.FAIL;

  let cryptographicSignatureValid = false;
  let signatureError = "";
  try {
    cryptographicSignatureValid = await signedData.verify({
      signer: 0,
      data: exactArrayBuffer(signedBytes),
      checkChain: false
    });
  } catch (error) {
    signatureError = error instanceof Error ? error.message : String(error);
  }

  const signerCertificate = findSignerCertificate(signedData, signerInfo);
  const embeddedCertificates = (signedData.certificates || []).filter(
    (certificate) => certificate instanceof Certificate
  );
  const certificateStatus = certificateDateStatus(
    signerCertificate,
    verificationTime
  );
  const certificateSubject = signerCertificate
    ? certificateName(signerCertificate.subject)
    : "";
  const certificateIssuer = signerCertificate
    ? certificateName(signerCertificate.issuer)
    : "";
  const certificateValidity = signerCertificate
    ? `Valid from ${signerCertificate.notBefore.value.toLocaleDateString()} to ${signerCertificate.notAfter.value.toLocaleDateString()} (${certificateStatus === CHECK_STATUS.PASS ? "valid" : certificateStatus === "expired" ? "expired" : "not yet valid"})`
    : "Signer certificate was not found";
  const certificateTrust = await evaluateCertificateTrust({
    signerCertificate,
    embeddedCertificates,
    trustedCertificates,
    verificationTime
  });
  const issuerCertificate = signerCertificate
    ? embeddedCertificates.find(
        (certificate) =>
          normalizedName(certificate.subject) ===
            normalizedName(signerCertificate.issuer) &&
          certificateIdentity(certificate) !==
            certificateIdentity(signerCertificate)
      ) || signerCertificate
    : null;
  const cryptographicSignatureStatus = cryptographicSignatureValid
    ? CHECK_STATUS.PASS
    : CHECK_STATUS.FAIL;
  const coreChecksPass =
    documentIntegrityStatus === CHECK_STATUS.PASS &&
    cryptographicSignatureStatus === CHECK_STATUS.PASS;
  const overallStatus = !coreChecksPass
    ? CHECK_STATUS.FAIL
    : certificateStatus === CHECK_STATUS.PASS &&
        certificateTrust.status === CERTIFICATE_TRUST_STATUS.TRUSTED
      ? CHECK_STATUS.PASS
      : CHECK_STATUS.WARNING;

  return {
    name: fieldName,
    status:
      overallStatus === CHECK_STATUS.PASS
        ? "Signature and document integrity verified"
        : overallStatus === CHECK_STATUS.WARNING
          ? "Signature verified with a certificate warning"
          : "Signature or document integrity verification failed",
    overallStatus,
    documentIntegrityStatus,
    cryptographicSignatureStatus,
    certificateStatus,
    certificateTrustStatus: certificateTrust.status,
    certificateTrustDetail: certificateTrust.detail,
    trustedTimestampStatus: descriptor.protectedEvidence.trustedTimestampStatus,
    revocationStatus: descriptor.revocationStatus || "unavailable",
    signerAuthenticationStatus:
      descriptor.protectedEvidence.signerAuthenticationStatus,
    auditTrailIntegrityStatus:
      descriptor.protectedEvidence.auditTrailIntegrityStatus,
    identifierProtectionStatus:
      descriptor.protectedEvidence.identifierProtectionStatus,
    revisionPermissionsStatus,
    verificationEvidence: descriptor.protectedEvidence.verificationEvidence,
    certificateSubject,
    certificateIssuer,
    certificateValidity,
    certificateDer: certificateDerBase64(signerCertificate),
    issuerCertificateDer: certificateDerBase64(issuerCertificate),
    certificateServiceUrls: certificateServiceUrls(signerCertificate),
    calculatedDocumentHash: toHex(calculatedDigest),
    messageDigestInSignature: embeddedDigest ? toHex(embeddedDigest) : "",
    hashComparisonResult: digestMatches
      ? "Document digest matches"
      : "Document digest does not match",
    authenticatedAttributesSignatureResult: cryptographicSignatureValid
      ? "Cryptographic signature verified"
      : "Cryptographic signature verification failed",
    byteRange,
    signedRevisionLength,
    coversWholeFile,
    unsignedTrailingBytes,
    signerInfo: certificateSubject
      ? `Signer: ${certificateSubject}, Issuer: ${certificateIssuer}`
      : "Signer certificate was not found",
    errorDetails:
      signatureError ||
      (!embeddedDigest
        ? "The CMS messageDigest signed attribute is missing."
        : undefined) ||
      (unsignedTrailingBytes
        ? "Unsigned data exists after the latest signed PDF revision."
        : undefined)
  };
}

export async function verifyPdfSignatures(input, options = {}) {
  const verificationTime = options.verificationTime
    ? new Date(options.verificationTime)
    : new Date();
  if (Number.isNaN(verificationTime.getTime()))
    throw new Error("Invalid verification time.");

  const fileBytes = exactBytes(input);
  const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
  const signatureFields = pdfDoc
    .getForm()
    .getFields()
    .filter((field) => field instanceof PDFSignature);

  if (!signatureFields.length) {
    return {
      error: "No digital signature was found in the PDF.",
      code: "NO_SIGNATURE",
      results: []
    };
  }

  const descriptors = [];
  const results = [];
  const protectedEvidence = await verifyProtectedEvidence(
    extractVerificationEvidence(pdfDoc),
    options.tsaTrustedCertificates || options.trustedCertificates || []
  );
  for (const field of signatureFields) {
    const fieldName = field.getName() || "Unnamed signature field";
    try {
      const signatureDictionary = getSignatureDictionary(pdfDoc, field);
      if (!signatureDictionary)
        throw new Error("The PDF signature dictionary is missing or invalid.");
      const range = parseByteRange(signatureDictionary, fileBytes.length);
      descriptors.push({
        fieldName,
        ...range,
        signedBytes: reconstructSignedBytes(fileBytes, range.byteRange),
        signedData: parseCms(signatureDictionary),
        docMdpPermission: docMdpPermission(pdfDoc, signatureDictionary),
        protectedEvidence
      });
    } catch (error) {
      results.push(errorResult(fieldName, error));
    }
  }

  const latestRevisionLength = descriptors.reduce(
    (latest, descriptor) => Math.max(latest, descriptor.signedRevisionLength),
    0
  );
  for (const descriptor of descriptors) {
    try {
      results.push(
        await verifyDescriptor(
          descriptor,
          fileBytes,
          verificationTime,
          latestRevisionLength,
          options.trustedCertificates || []
        )
      );
    } catch (error) {
      results.push(errorResult(descriptor.fieldName, error));
    }
  }

  return { results };
}
