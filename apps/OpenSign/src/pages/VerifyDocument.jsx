import { useState } from "react";
import { useTranslation } from "react-i18next";
import Parse from "parse";
import {
  CHECK_STATUS,
  parseTrustedCertificates,
  verifyPdfSignatures
} from "../utils/pdfSignatureVerification.mjs";

// Small inline icon set for the verify-document page's redesigned layout -
// no icon package dependency, just outline-style SVGs matching the rest of
// the app's existing hand-drawn icon usage elsewhere in this codebase.
const ShieldIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
  </svg>
);
const ShieldCheckIcon = ShieldIcon;
const PdfFileIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none">
    <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="#FEE2E2" stroke="#DC2626" strokeWidth={1.2} />
    <path d="M15 2v5h5" fill="none" stroke="#DC2626" strokeWidth={1.2} strokeLinejoin="round" />
    <text x="12" y="17" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#DC2626">PDF</text>
  </svg>
);
const SwapIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h13m0 0-4-4m4 4-4 4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 17H7m0 0 4 4m-4-4 4-4" />
  </svg>
);
const CheckCircleIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.5 2.5 2.5 4.5-5" />
  </svg>
);
const CheckBadgeIcon = CheckCircleIcon;
const XCircleIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m9.5 9.5 5 5m0-5-5 5" />
  </svg>
);
const WarningIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5 21.5 20h-19L12 3.5Z" />
    <path strokeLinecap="round" d="M12 10v4" />
    <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);
const LockIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path strokeLinecap="round" d="M8 11V7a4 4 0 1 1 8 0v4" />
  </svg>
);
const PersonIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="8" r="3.5" />
    <path strokeLinecap="round" d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
  </svg>
);
const BuildingIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="4" y="4" width="16" height="17" rx="1" />
    <path strokeLinecap="round" d="M8 8h1M12 8h1M16 8h1M8 12h1M12 12h1M16 12h1M8 16h1M12 16h1M16 16h1M10 21v-3h4v3" />
  </svg>
);
const CalendarCheckIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path strokeLinecap="round" d="M4 9h16M8 3v4M16 3v4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m9 14 2 2 4-4" />
  </svg>
);
const WrenchIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.2 2.2-2-2 2.2-2.2Z" />
  </svg>
);

let configuredTrustAnchors = [];
try {
  configuredTrustAnchors = parseTrustedCertificates(
    import.meta.env.VITE_SIGNATURE_TRUST_ANCHORS || ""
  );
} catch (error) {
  console.error("Invalid VITE_SIGNATURE_TRUST_ANCHORS configuration:", error);
}

// One card per actual human participant (name/email/location/IP), pulled
// from the document's protected verification-evidence manifest - not the
// certificate DN, which only describes the platform's own self-signed
// identity and is identical for every document regardless of who signed it.
function participantsFromEvidence(evidence) {
  return Array.isArray(evidence?.participants) ? evidence.participants : [];
}

function toGeoFields(geo) {
  if (!geo) return null;
  return {
    ip: geo.ip || "",
    country: geo.countryCode || geo.country || "",
    state: geo.region || "",
    locality: geo.city || ""
  };
}

// Renders the signing instant in the signer's OWN timezone (resolved from
// their signing IP via resolveipgeo), not the viewer's browser timezone -
// two people checking the same document in India and London should each
// read "signed at" as it actually was for that signer, not for themselves.
// Falls back to an explicit UTC label when no timezone could be resolved,
// rather than silently defaulting to the viewer's zone (which would be
// wrong, not just imprecise).
function formatSignedAt(isoString, timezoneId) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezoneId || "UTC",
      dateStyle: "medium",
      timeStyle: "long"
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

async function addSignerGeoResults(results) {
  const originIps = results
    .map((result) => result.verificationEvidence?.document?.originIp)
    .filter(Boolean);
  const participantIps = results.flatMap((result) =>
    participantsFromEvidence(result.verificationEvidence)
      .map((p) => p?.ipAddress)
      .filter(Boolean)
  );
  const allIps = [...new Set([...originIps, ...participantIps])];
  if (!allIps.length) {
    return results.map((result) => ({ ...result, signerList: [], issuerGeo: null }));
  }
  let geoByIp = {};
  try {
    geoByIp = (await Parse.Cloud.run("resolveipgeo", { ips: allIps })) || {};
  } catch {
    // A dead/slow geo lookup must not block showing the rest of the
    // verification result - the location/IP fields just stay empty.
  }
  return results.map((result) => {
    const participants = participantsFromEvidence(result.verificationEvidence);
    const signerList = participants.map((p, i) => {
      const geo = p?.ipAddress ? geoByIp[p.ipAddress] : null;
      return {
        key: p?.participantId || `${i}`,
        name: p?.name || "Unknown signer",
        email: p?.email || "",
        signedAt: p?.signedAt || "",
        timezoneId: geo?.timezoneId || "",
        ip: p?.ipAddress || "",
        country: geo?.countryCode || geo?.country || "",
        state: geo?.region || "",
        locality: geo?.city || ""
      };
    });
    const originIp = result.verificationEvidence?.document?.originIp || "";
    const issuerGeo = originIp
      ? toGeoFields({ ip: originIp, ...geoByIp[originIp] })
      : null;
    return { ...result, signerList, issuerGeo };
  });
}

async function addRevocationResult(result) {
  const urls = result.certificateServiceUrls || {};
  if (!result.certificateDer || !result.issuerCertificateDer) return result;
  for (const [mode, candidates] of [
    ["ocsp", urls.ocsp || []],
    ["crl", urls.crl || []]
  ]) {
    for (const url of candidates) {
      try {
        const response = await Parse.Cloud.run("verifycertificateevidence", {
          mode,
          url,
          certificateDer: result.certificateDer,
          issuerCertificateDer: result.issuerCertificateDer
        });
        if (["good", "revoked", "malformed"].includes(response?.status)) {
          return { ...result, revocationStatus: response.status };
        }
      } catch {
        // Try the next certificate-advertised responder or CRL endpoint.
      }
    }
  }
  return result;
}

const VerifyDocument = () => {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileBuffer, setFileBuffer] = useState(null);
  const [verificationResult, setVerificationResult] = useState("");
  const [detailedResults, setDetailedResults] = useState([]);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [isDragActive, setIsDragActive] = useState(false);
  // const [jsrsasignStatus, setJsrsasignStatus] = useState('loading'); // Removed

  // OID to human-readable label mapping
  const oidMapping = {
    "2.5.4.6": "Country",
    "2.5.4.10": "Organization",
    "2.5.4.11": "Organizational Unit",
    "2.5.4.17": "Postal Code",
    "2.5.4.8": "State",
    "2.5.4.7": "Locality", // Alternative for City
    "2.5.4.9": "City",
    "2.5.4.51": "Address",
    "2.5.4.3": "Common Name",
    "2.5.4.4": "Surname",
    "2.5.4.5": "Serial Number",
    "2.5.4.12": "Title",
    "2.5.4.13": "Description",
    "2.5.4.16": "Postal Address",
    "2.5.4.18": "Post Office Box",
    "2.5.4.20": "Telephone Number",
    "1.2.840.113549.1.9.1": "Email Address",
    // Common alternative OIDs
    C: "Country",
    O: "Organization",
    OU: "Organizational Unit",
    CN: "Common Name",
    ST: "State",
    L: "Locality",
    STREET: "Address",
    emailAddress: "Email Address",
    serialNumber: "Serial Number"
  };

  // Function to parse certificate subject/issuer into structured data
  const parseCertificateInfo = (certString) => {
    if (!certString) return {};

    const parsed = {};

    // Find all OID patterns and their positions
    // Must match an OID of ANY length (2+ dot-separated segments), not just
    // exactly 4 - the email OID (1.2.840.113549.1.9.1) has 7. Requiring
    // exactly 4 made this match only the OID's tail ("113549.1.9.1="),
    // leaving the skipped prefix ("1.2.840.") glued onto the previous
    // field's value - that's what put "1.2.84" on the end of Common Name
    // and showed the email field as the raw truncated OID "113549.1.9.1".
    const oidPattern = /(\d+(?:\.\d+)+|\w+)=/g;
    const matches = [];
    let match;

    while ((match = oidPattern.exec(certString)) !== null) {
      matches.push({
        oid: match[1],
        startIndex: match.index,
        equalIndex: match.index + match[1].length
      });
    }

    // Extract value for each OID
    for (let i = 0; i < matches.length; i++) {
      const currentMatch = matches[i];
      const nextMatch = matches[i + 1];

      const valueStart = currentMatch.equalIndex + 1; // Skip the "=" character
      const valueEnd = nextMatch ? nextMatch.startIndex - 2 : certString.length; // -2 to remove ", " before next OID

      const value = certString.substring(valueStart, valueEnd).trim();
      const label = oidMapping[currentMatch.oid] || currentMatch.oid;

      parsed[label] = value;
    }

    return parsed;
  };

  // Function to determine if status should show success icon
  const isSuccessStatus = (status) => {
    const successTerms = ["valid", "success", "parsed", "verified"];
    const errorTerms = ["error", "invalid", "failed", "expired"];

    const statusLower = status.toLowerCase();

    // Check for explicit error terms first
    if (errorTerms.some((term) => statusLower.includes(term))) {
      return false;
    }

    // Check for success terms
    return successTerms.some((term) => statusLower.includes(term));
  };

  // Function to determine if certificate validity should show success icon
  const isCertificateValid = (validityText) => {
    const validityLower = validityText.toLowerCase();

    // If it contains "valid" and doesn't contain negative terms
    return (
      validityLower.includes("valid") &&
      !validityLower.includes("expired") &&
      !validityLower.includes("not yet valid") &&
      !validityLower.includes("invalid")
    );
  };

  // Toggle collapsible sections
  const toggleSection = (signatureIndex, section) => {
    const key = `${signatureIndex}-${section}`;
    setCollapsedSections((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Shared by both the plain file input (click-to-choose) and the dropzone's
  // onDrop - same exact selection logic either way, so drag-and-drop can't
  // diverge from (or accidentally bypass) whatever click-upload already does.
  const applySelectedFile = (file) => {
    if (file && file.type === "application/pdf") {
      setSelectedFile(file);
      setVerificationResult("");
      setDetailedResults([]);
      const reader = new FileReader();
      reader.onload = (e) => {
        setFileBuffer(e.target.result);
      };
      reader.readAsArrayBuffer(file);
    } else {
      setSelectedFile(null);
      setFileBuffer(null);
      setDetailedResults([]);
      setVerificationResult(t("please-select-pdf"));
    }
  };

  const handleFileChange = (event) => {
    applySelectedFile(event.target.files[0]);
  };

  const handleDropFile = (event) => {
    event.preventDefault();
    setIsDragActive(false);
    applySelectedFile(event.dataTransfer.files?.[0]);
  };

  const handleVerifyDocument = async () => {
    // Removed jsrsasignStatus check

    if (!fileBuffer) {
      setVerificationResult(t("please-select-file-to-verify"));
      setDetailedResults([]);
      return;
    }

    setVerificationResult(t("verification-in-progress"));
    setDetailedResults([]);

    try {
      const signatureInfo = await verifyPdfSignatures(fileBuffer, {
        trustedCertificates: configuredTrustAnchors
      });

      if (signatureInfo.error) {
        setVerificationResult(signatureInfo.error);
      } else if (signatureInfo.results && signatureInfo.results.length > 0) {
        const revocationEnriched = await Promise.all(
          signatureInfo.results.map(addRevocationResult)
        );
        const enrichedResults = await addSignerGeoResults(revocationEnriched);
        setDetailedResults(enrichedResults);
        const coreChecksPass = enrichedResults.every(
          (result) =>
            result.documentIntegrityStatus === CHECK_STATUS.PASS &&
            result.cryptographicSignatureStatus === CHECK_STATUS.PASS
        );
        const certificateDatesValid = enrichedResults.every(
          (result) => result.certificateStatus === CHECK_STATUS.PASS
        );
        const certificateChainsTrusted = enrichedResults.every(
          (result) => result.certificateTrustStatus === "trusted"
        );
        setVerificationResult(
          !coreChecksPass
            ? t("some-signatures-invalid-basic")
            : certificateDatesValid && certificateChainsTrusted
              ? t("all-signatures-verified-convincing")
              : "Document integrity and cryptographic signatures verified. Review the certificate date or trust warning below."
        );
      } else {
        setVerificationResult(t("no-signatures-processed")); // Should be caught by no-signature-found earlier
      }
    } catch (e) {
      console.error(
        "Error during PDF processing or signature verification:",
        e
      );
      setVerificationResult(`${t("error-verifying-pdf")}: ${e.message}`);
      setDetailedResults([]);
    }
  };

  const isVerifying = verificationResult === t("verification-in-progress");
  const hasResults = detailedResults.length > 0;
  const overallVerified =
    hasResults &&
    detailedResults.every(
      (result) =>
        result.documentIntegrityStatus === CHECK_STATUS.PASS &&
        result.cryptographicSignatureStatus === CHECK_STATUS.PASS
    );
  const hasCertWarning =
    hasResults &&
    detailedResults.some(
      (result) =>
        result.certificateTrustStatus !== "trusted" ||
        result.certificateStatus !== CHECK_STATUS.PASS ||
        result.revocationStatus !== "good"
    );

  return (
    <div className="w-[97%] max-w-[1800px] mx-auto p-4 sm:p-6">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Page header */}
        <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-gray-100">
          <h1 className="text-2xl font-bold text-gray-900">
            {t("verify-document-signature")}
          </h1>
          <div className="hidden sm:flex items-center gap-1.5 text-green-600 font-semibold text-sm shrink-0">
            <ShieldIcon className="w-5 h-5" />
            Trusted Verification
          </div>
        </div>

        {/* Upload box (no file yet) / compact file bar (file selected) -
            same input, same handler, same verification flow either way;
            the dropzone's onDrop calls the exact same applySelectedFile()
            the click-upload input already used. */}
        {!selectedFile ? (
          <div className="px-6 py-6 border-b border-gray-100">
            <label
              htmlFor="document-upload"
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={handleDropFile}
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-300 bg-gray-50 hover:bg-gray-100"
              }`}
            >
              <PdfFileIcon className="w-10 h-10" />
              <p className="font-semibold text-gray-900 mt-1">
                Upload PDF Document
              </p>
              <p className="text-sm text-gray-500">
                Drag &amp; drop your signed PDF here, or
              </p>
              <span className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 mt-1">
                Choose File
              </span>
              <p className="text-xs text-gray-400 mt-2">
                Only PDF files are supported
              </p>
            </label>
            <input
              type="file"
              id="document-upload"
              accept=".pdf"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3 min-w-0">
              <PdfFileIcon className="w-9 h-9 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500">
                  PDF Document
                </p>
                <p className="font-semibold text-gray-900 truncate">
                  {selectedFile.name}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <label
                htmlFor="document-upload"
                className="cursor-pointer inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <SwapIcon className="w-4 h-4" />
                Change file
              </label>
              <input
                type="file"
                id="document-upload"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={handleVerifyDocument}
                disabled={!selectedFile || isVerifying}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {isVerifying ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  <ShieldCheckIcon className="w-4 h-4" />
                )}
                {t("verify-signature")}
              </button>
            </div>
          </div>
        )}

        <div className="p-6 space-y-6">
          {isVerifying && (
            <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 min-h-[100px] flex justify-center items-center">
              <span className="loading loading-lg loading-dots"></span>
            </div>
          )}

          {verificationResult && !isVerifying && (
            <div
              className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border p-4 ${
                overallVerified
                  ? "bg-green-50 border-green-200"
                  : "bg-red-50 border-red-200"
              }`}
            >
              <div className="flex items-center gap-3">
                {overallVerified ? (
                  <CheckCircleIcon className="w-7 h-7 text-green-600 shrink-0" />
                ) : (
                  <XCircleIcon className="w-7 h-7 text-red-600 shrink-0" />
                )}
                <div>
                  <p className="font-bold text-gray-900">
                    {overallVerified
                      ? "Signature verified"
                      : "Verification failed"}
                  </p>
                  <p className="text-sm text-gray-600">
                    {verificationResult}
                  </p>
                </div>
              </div>
              {overallVerified && hasCertWarning && (
                <span className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 shrink-0">
                  <WarningIcon className="w-3.5 h-3.5" />
                  Certificate warning
                </span>
              )}
            </div>
          )}

          {hasResults && (
            <div className="space-y-6">
              <>
                {detailedResults.map((res, index) => {
                  // Issuer Details stays the certificate's own static
                  // identity (it's a self-signed platform certificate, not a
                  // person, so it has no location). Signer Information is
                  // rendered separately below as a per-participant list.
                  // Issuer Details' Country/State/Locality are overridden
                  // with where the document was actually initiated/sent
                  // from (res.issuerGeo, resolved from OriginIp - the
                  // creator's IP captured at document-creation time), not
                  // the certificate's own static org address. Organization
                  // is likewise overridden with the actual sending company's
                  // name - the shared platform signing certificate's own O=
                  // is always "SignToowix" regardless of which tenant sent
                  // the document, so left alone it named the platform
                  // instead of the issuer. Common Name still describes the
                  // certificate itself. Email Address is dropped entirely -
                  // it's the shared platform certificate's own static
                  // address (hello@toowix.com on every document), not
                  // anything belonging to the actual issuer, so it's not
                  // just wrong like Organization was, it's misleading with
                  // no correct per-issuer value to substitute in its place.
                  const issuerOrganization =
                    res.verificationEvidence?.document?.organization;
                  const { "Email Address": _issuerEmail, ...certificateInfo } =
                    parseCertificateInfo(res.certificateIssuer);
                  const issuerInfo = {
                    ...certificateInfo,
                    ...(issuerOrganization
                      ? { Organization: issuerOrganization }
                      : {}),
                    ...(res.issuerGeo?.country ? { Country: res.issuerGeo.country } : {}),
                    ...(res.issuerGeo?.state ? { State: res.issuerGeo.state } : {}),
                    ...(res.issuerGeo?.locality
                      ? { Locality: res.issuerGeo.locality }
                      : {}),
                    ...(res.issuerGeo?.ip ? { "IP Address": res.issuerGeo.ip } : {})
                  };
                  const signerList = res.signerList || [];
                  const overallIsAcceptable =
                    res.overallStatus === CHECK_STATUS.PASS ||
                    res.overallStatus === CHECK_STATUS.WARNING;
                  const verificationChecks = [
                    {
                      label: "Document Integrity",
                      status: res.documentIntegrityStatus,
                      detail:
                        res.documentIntegrityStatus === CHECK_STATUS.PASS
                          ? "The signed document bytes match the protected SHA digest."
                          : "The signed content changed or unsigned data was appended."
                    },
                    {
                      label: "Cryptographic Signature",
                      status: res.cryptographicSignatureStatus,
                      detail:
                        res.cryptographicSignatureStatus === CHECK_STATUS.PASS
                          ? "The CMS signature verifies with the embedded certificate."
                          : "The CMS signature could not be cryptographically verified."
                    },
                    {
                      label: "Certificate Status",
                      status: res.certificateStatus,
                      detail:
                        res.certificateStatus === CHECK_STATUS.PASS
                          ? "The certificate is within its validity period."
                          : res.certificateStatus === "expired"
                            ? "The certificate is expired; document integrity is reported separately."
                            : res.certificateStatus === "not_yet_valid"
                              ? "The certificate is not yet valid."
                              : "The certificate validity could not be determined."
                    },
                    {
                      label: "Certificate Trust",
                      status: res.certificateTrustStatus,
                      detail:
                        res.certificateTrustDetail ||
                        "The certificate trust chain could not be determined."
                    },
                    {
                      label: "Revocation",
                      status: res.revocationStatus,
                      detail:
                        res.revocationStatus === "good"
                          ? "The issuing authority reports that the certificate is not revoked."
                          : "No validated OCSP or CRL result is embedded in this document."
                    },
                    {
                      label: "Signer Authentication",
                      status: res.signerAuthenticationStatus,
                      detail:
                        res.signerAuthenticationStatus === "verified"
                          ? "All participants have protected authentication evidence."
                          : res.signerAuthenticationStatus ===
                              "partially_verified"
                            ? "Participant email-link evidence is protected, but it is not strong identity proof."
                            : "Protected participant authentication evidence is unavailable or inconsistent."
                    },
                    {
                      label: "Audit Trail Integrity",
                      status: res.auditTrailIntegrityStatus,
                      detail:
                        res.auditTrailIntegrityStatus === CHECK_STATUS.PASS
                          ? "The signed audit manifest and event hash chain are intact."
                          : "The protected audit manifest is unavailable or does not validate."
                    },
                    {
                      label: "Revision Permissions",
                      status: res.revisionPermissionsStatus,
                      detail:
                        res.revisionPermissionsStatus === "permitted"
                          ? "The final platform signature covers the whole file under DocMDP permission 1."
                          : res.revisionPermissionsStatus === "not_applicable"
                            ? "This legacy signature does not declare DocMDP permissions."
                            : "The PDF contains an unauthorized or indeterminate later revision."
                    },
                    {
                      label: "Protected Identifiers",
                      status: res.identifierProtectionStatus,
                      detail:
                        res.identifierProtectionStatus === CHECK_STATUS.PASS
                          ? "Document, transaction and certificate identifiers are protected by the signed manifest."
                          : "Protected transaction identifiers are unavailable or inconsistent."
                    }
                  ];

                  return (
                    <div
                      key={index}
                      className="bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
                    >
                      {/* Header Section */}
                      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4">
                        <div className="flex items-center gap-3">
                          <LockIcon className="w-5 h-5" />
                          <h4 className="text-lg font-bold">
                            Signature Details
                          </h4>
                        </div>
                      </div>

                      {/* Basic Info Section */}
                      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4 border-b border-gray-100">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500">
                            Field name:
                          </span>
                          <span className="text-sm font-bold text-gray-900">
                            {res.name}
                          </span>
                        </div>
                        <div className="hidden sm:block w-px h-4 bg-gray-200" />
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500">
                            Overall status:
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                            {overallIsAcceptable ? (
                              <CheckBadgeIcon className="w-4 h-4 text-green-600" />
                            ) : (
                              <XCircleIcon className="w-4 h-4 text-red-600" />
                            )}
                            {res.status}
                          </span>
                        </div>
                      </div>

                      {/* Independent Phase 1 verification results */}
                      <div className="p-6 border-b border-gray-100">
                        <h5 className="text-base font-bold text-gray-900 mb-4">
                          Verification Checks
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {verificationChecks.map((check) => {
                            const passed =
                              check.status === CHECK_STATUS.PASS ||
                              check.status === "trusted";
                            const warning =
                              check.status === CHECK_STATUS.WARNING ||
                              check.status === "expired" ||
                              check.status === "not_yet_valid" ||
                              check.status === "self_signed" ||
                              check.status === "chain_valid_untrusted_root" ||
                              check.status === "unavailable" ||
                              check.status === "partially_verified" ||
                              check.status === "not_applicable" ||
                              check.status === CHECK_STATUS.UNKNOWN;
                            const semanticPass = [
                              "good",
                              "verified",
                              "permitted"
                            ].includes(check.status);
                            const ok = passed || semanticPass;
                            return (
                              <div
                                key={check.label}
                                className={`rounded-lg border p-4 ${
                                  ok
                                    ? "border-green-200 bg-green-50"
                                    : warning
                                      ? "border-amber-200 bg-amber-50"
                                      : "border-red-200 bg-red-50"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="flex items-center gap-2 font-semibold text-gray-900">
                                    {ok ? (
                                      <CheckCircleIcon className="w-5 h-5 text-green-600 shrink-0" />
                                    ) : warning ? (
                                      <WarningIcon className="w-5 h-5 text-amber-600 shrink-0" />
                                    ) : (
                                      <XCircleIcon className="w-5 h-5 text-red-600 shrink-0" />
                                    )}
                                    {check.label}
                                  </span>
                                  <span
                                    className={`text-xs font-bold uppercase ${
                                      ok
                                        ? "text-green-700"
                                        : warning
                                          ? "text-amber-700"
                                          : "text-red-700"
                                    }`}
                                  >
                                    {ok
                                      ? "Pass"
                                      : warning
                                        ? check.status.replaceAll("_", " ")
                                        : "Fail"}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm text-gray-700">
                                  {check.detail}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Signer Information Section - one card per actual
                          participant, not the certificate DN (see note above
                          the signerList/issuerInfo declaration). */}
                      <div className="p-6 border-b border-gray-100 space-y-6">
                        {/* Signer Information - full width, table, one row
                            per actual participant (see note above the
                            signerList/issuerInfo declaration). */}
                        {signerList.length > 0 && (
                          <div className="border border-gray-200 rounded-xl overflow-hidden">
                            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100">
                              <PersonIcon className="w-5 h-5 text-gray-700" />
                              <h5 className="text-base font-bold text-gray-900">
                                Signer Information
                              </h5>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                                    <th className="px-5 py-2 font-medium">
                                      Signer
                                    </th>
                                    <th className="px-3 py-2 font-medium">
                                      Country
                                    </th>
                                    <th className="px-3 py-2 font-medium">
                                      State
                                    </th>
                                    <th className="px-3 py-2 font-medium">
                                      Locality
                                    </th>
                                    <th className="px-3 py-2 font-medium">
                                      IP address
                                    </th>
                                    <th className="px-3 py-2 font-medium">
                                      Signed at
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {signerList.map((signer, signerIdx) => (
                                    <tr
                                      key={signer.key}
                                      className="border-b border-gray-50 last:border-0 align-top"
                                    >
                                      <td className="px-5 py-3 whitespace-nowrap">
                                        <div className="flex items-center gap-2.5">
                                          <span className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center text-xs font-semibold text-gray-600 shrink-0">
                                            {signerIdx + 1}
                                          </span>
                                          <div>
                                            <p className="font-semibold text-gray-900">
                                              {signer.name}
                                            </p>
                                            {signer.email && (
                                              <p className="text-xs text-gray-500">
                                                {signer.email}
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-3 py-3 text-gray-700">
                                        {signer.country || "—"}
                                      </td>
                                      <td className="px-3 py-3 text-gray-700">
                                        {signer.state || "—"}
                                      </td>
                                      <td className="px-3 py-3 text-gray-700">
                                        {signer.locality || "—"}
                                      </td>
                                      <td className="px-3 py-3 text-gray-700 font-mono text-xs">
                                        {signer.ip || "—"}
                                      </td>
                                      <td className="px-3 py-3 text-gray-700 whitespace-nowrap">
                                        {formatSignedAt(
                                          signer.signedAt,
                                          signer.timezoneId
                                        ) || "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Issuer Details - full width, below Signer
                            Information, not beside it. */}
                        {(Object.keys(issuerInfo).length > 0 ||
                          res.certificateValidity) && (
                          <div className="border border-gray-200 rounded-xl overflow-hidden">
                            {Object.keys(issuerInfo).length > 0 && (
                              <>
                                <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100">
                                  <BuildingIcon className="w-5 h-5 text-gray-700" />
                                  <h5 className="text-base font-bold text-gray-900">
                                    Issuer Details
                                  </h5>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                                        {Object.keys(issuerInfo).map(
                                          (label) => (
                                            <th
                                              key={label}
                                              className="px-5 py-2 font-medium whitespace-nowrap"
                                            >
                                              {label}
                                            </th>
                                          )
                                        )}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        {Object.values(issuerInfo).map(
                                          (value, i) => (
                                            <td
                                              key={i}
                                              className="px-5 py-3 text-gray-900 font-mono text-xs break-all"
                                            >
                                              {value}
                                            </td>
                                          )
                                        )}
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}
                            {res.certificateValidity && (
                              <div className="px-5 py-3 border-t border-gray-100">
                                <div
                                  className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 ${
                                    isCertificateValid(res.certificateValidity)
                                      ? "border-green-200 bg-green-50"
                                      : "border-red-200 bg-red-50"
                                  }`}
                                >
                                  {isCertificateValid(
                                    res.certificateValidity
                                  ) ? (
                                    <CalendarCheckIcon className="w-5 h-5 text-green-600 shrink-0" />
                                  ) : (
                                    <XCircleIcon className="w-5 h-5 text-red-600 shrink-0" />
                                  )}
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900">
                                      Certificate Validity
                                    </p>
                                    <p className="text-xs text-gray-600 font-mono">
                                      {res.certificateValidity}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Technical Details Section (if any) */}
                      {(res.calculatedDocumentHash ||
                        res.messageDigestInSignature ||
                        res.hashComparisonResult ||
                        res.authenticatedAttributesSignatureResult ||
                        res.errorDetails ||
                        res.certificateSubject ||
                        res.certificateIssuer) && (
                        <div className="p-6">
                          <details className="group border border-gray-200 rounded-xl">
                            <summary className="flex items-center justify-between gap-3 cursor-pointer px-5 py-4 text-sm font-bold text-gray-900 hover:bg-gray-50 rounded-xl">
                              <span className="flex items-center gap-2.5">
                                <WrenchIcon className="w-5 h-5 text-gray-700" />
                                Technical Details
                              </span>
                              <svg
                                className="w-4 h-4 transition-transform group-open:rotate-180"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 9l-7 7-7-7"
                                />
                              </svg>
                            </summary>
                            <div className="px-5 pb-5 space-y-3">
                              {/* Raw Certificate Data */}
                              {res.certificateSubject && (
                                <div className="bg-white rounded p-3 border">
                                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">
                                    Raw Certificate Subject
                                  </span>
                                  <code className="text-xs text-gray-800 break-all bg-gray-100 p-2 rounded block">
                                    {res.certificateSubject}
                                  </code>
                                </div>
                              )}
                              {res.certificateIssuer && (
                                <div className="bg-white rounded p-3 border">
                                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">
                                    Raw Certificate Issuer
                                  </span>
                                  <code className="text-xs text-gray-800 break-all bg-gray-100 p-2 rounded block">
                                    {res.certificateIssuer}
                                  </code>
                                </div>
                              )}
                              {res.calculatedDocumentHash &&
                                res.calculatedDocumentHash !==
                                  t("not-available") &&
                                res.calculatedDocumentHash !==
                                  t("not-calculated") && (
                                  <div className="bg-white rounded p-3 border">
                                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">
                                      Calculated Document Hash
                                    </span>
                                    <code className="text-xs text-gray-800 break-all bg-gray-100 p-2 rounded block">
                                      {res.calculatedDocumentHash}
                                    </code>
                                  </div>
                                )}
                              {res.messageDigestInSignature &&
                                res.messageDigestInSignature !==
                                  t("not-available") &&
                                res.messageDigestInSignature !==
                                  t("not-found-in-signature") && (
                                  <div className="bg-white rounded p-3 border">
                                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">
                                      Message Digest in Signature
                                    </span>
                                    <code className="text-xs text-gray-800 break-all bg-gray-100 p-2 rounded block">
                                      {res.messageDigestInSignature}
                                    </code>
                                  </div>
                                )}
                              {res.hashComparisonResult &&
                                res.hashComparisonResult !==
                                  t("not-performed") && (
                                  <div className="bg-white rounded p-3 border">
                                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">
                                      Hash Comparison
                                    </span>
                                    <span className="text-sm text-gray-800">
                                      {res.hashComparisonResult}
                                    </span>
                                  </div>
                                )}
                              {res.authenticatedAttributesSignatureResult &&
                                res.authenticatedAttributesSignatureResult !==
                                  t("not-performed") && (
                                  <div className="bg-white rounded p-3 border">
                                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">
                                      Attributes Signature Verification
                                    </span>
                                    <span className="text-sm text-gray-800">
                                      {
                                        res.authenticatedAttributesSignatureResult
                                      }
                                    </span>
                                  </div>
                                )}
                              {res.errorDetails && (
                                <div className="bg-red-50 border border-red-200 rounded p-3">
                                  <span className="text-xs font-medium text-red-600 uppercase tracking-wide block mb-1">
                                    Error Details
                                  </span>
                                  <span className="text-sm text-red-800">
                                    {res.errorDetails}
                                  </span>
                                </div>
                              )}
                            </div>
                          </details>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VerifyDocument;
