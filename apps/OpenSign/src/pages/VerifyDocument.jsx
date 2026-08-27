import { useState } from "react";
import { useTranslation } from "react-i18next";
import Parse from "parse";
import {
  CHECK_STATUS,
  parseTrustedCertificates,
  verifyPdfSignatures
} from "../utils/pdfSignatureVerification.mjs";

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
    const oidPattern = /(\d+\.\d+\.\d+\.\d+|\w+)=/g;
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

  const handleFileChange = (event) => {
    const file = event.target.files[0];
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

  return (
    <div className="container mx-auto p-6 bg-base-100 shadow-xl rounded-lg mt-10">
      <style>{`
        .checkmark__circle {
          stroke-dasharray: 166;
          stroke-dashoffset: 166;
          stroke-width: 2;
          stroke-miterlimit: 10;
          stroke: #7ac142; /* Green color */
          fill: none;
          animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
        }

        .checkmark {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          display: block;
          stroke-width: 2;
          stroke: #fff; /* White check path */
          stroke-miterlimit: 10;
          margin: 10px auto; /* Example margin */
          box-shadow: inset 0px 0px 0px #7ac142;
          animation: fill .4s ease-in-out .4s forwards, scale .3s ease-in-out .9s both;
        }

        .checkmark__check {
          transform-origin: 50% 50%;
          stroke-dasharray: 48;
          stroke-dashoffset: 48;
          animation: stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.8s forwards;
        }

        @keyframes stroke {
          100% {
            stroke-dashoffset: 0;
          }
        }

        @keyframes scale {
          0%, 100% {
            transform: none;
          }
          50% {
            transform: scale3d(1.1, 1.1, 1);
          }
        }

        @keyframes fill {
          100% {
            box-shadow: inset 0px 0px 0px 30px #7ac142;
          }
        }
      `}</style>
      <h1 className="text-3xl font-bold mb-6 text-center text-base-content">
        {t("verify-document-signature")}
      </h1>

      <div className="mb-6 p-6 border border-base-300 rounded-lg bg-base-200/30 shadow-sm">
        <label
          htmlFor="document-upload"
          className="block text-lg font-medium text-base-content mb-2"
        >
          {t("select-pdf-document")}
        </label>
        <input
          type="file"
          id="document-upload"
          accept=".pdf"
          onChange={handleFileChange}
          className="file-input file-input-bordered file-input-primary w-full max-w-xs"
        />
        {selectedFile && (
          <p className="mt-2 text-sm text-base-content w-full truncate">
            {t("selected-file")}: {selectedFile.name}
          </p>
        )}
      </div>

      <div className="text-center mb-6">
        <button
          onClick={handleVerifyDocument}
          className="op-btn op-btn-primary op-btn-md"
          disabled={
            !selectedFile ||
            verificationResult === t("verification-in-progress")
          }
        >
          {/* Removed jsrsasignStatus === 'loading' condition for spinner */}
          {verificationResult === t("verification-in-progress") ? (
            <span className="loading loading-spinner"></span>
          ) : (
            t("verify-signature")
          )}
        </button>
      </div>

      {verificationResult &&
        verificationResult !== t("verification-in-progress") && (
          <div className="mt-8 p-6 border border-base-300 rounded-lg bg-base-200 shadow-md min-h-[120px] flex flex-col items-center justify-center">
            <h2 className="text-2xl font-bold mb-4 text-base-content text-center">
              {t("verification-status")}
            </h2>
            {detailedResults.length > 0 &&
              detailedResults.every(
                (result) =>
                  result.documentIntegrityStatus === CHECK_STATUS.PASS &&
                  result.cryptographicSignatureStatus === CHECK_STATUS.PASS
              ) && (
                <div className="flex flex-col items-center my-4">
                  <svg
                    className="checkmark"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 52 52"
                  >
                    <circle
                      className="checkmark__circle"
                      cx="26"
                      cy="26"
                      r="25"
                      fill="none"
                    />
                    <path
                      className="checkmark__check"
                      fill="none"
                      d="M14.1 27.2l7.1 7.2 16.7-16.8"
                    />
                  </svg>
                </div>
              )}
            <p className="text-lg text-base-content mb-4 text-center">
              {verificationResult}
            </p>
            {detailedResults.length > 0 && (
              <div className="w-full space-y-6">
                {detailedResults.map((res, index) => {
                  // Issuer Details stays the certificate's own static
                  // identity (it's a self-signed platform certificate, not a
                  // person, so it has no location). Signer Information is
                  // rendered separately below as a per-participant list.
                  // Issuer Details' Country/State/Locality are overridden
                  // with where the document was actually initiated/sent
                  // from (res.issuerGeo, resolved from OriginIp - the
                  // creator's IP captured at document-creation time), not
                  // the certificate's own static org address. Organization/
                  // Common Name/Email still describe the certificate itself.
                  const issuerInfo = {
                    ...parseCertificateInfo(res.certificateIssuer),
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
                      label: "Trusted Timestamp",
                      status: res.trustedTimestampStatus,
                      detail:
                        res.trustedTimestampStatus === "trusted"
                          ? "A valid RFC 3161 timestamp protects the signing time."
                          : "No validated RFC 3161 timestamp token is available."
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
                      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6">
                        <div className="flex items-center space-x-3">
                          <span className="text-2xl">🔏</span>
                          <div>
                            <h4 className="text-xl font-bold">
                              Signature Details
                            </h4>
                            <p className="text-blue-100 text-sm">
                              Digital Certificate Information
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Basic Info Section */}
                      <div className="p-6 border-b border-gray-100">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <span className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                              Field Name
                            </span>
                            <p className="mt-1 text-lg font-semibold text-gray-900 font-mono">
                              {res.name}
                            </p>
                          </div>
                          <div>
                            <span className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                              Overall Status
                            </span>
                            <div className="mt-1 flex items-center space-x-2">
                              <span
                                className={`text-lg ${overallIsAcceptable ? "text-green-600" : "text-red-600"}`}
                              >
                                {isSuccessStatus(res.status) ? "✅" : "❌"}
                              </span>
                              <span className="text-lg font-semibold text-gray-900">
                                {res.status}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Independent Phase 1 verification results */}
                      <div className="p-6 border-b border-gray-100">
                        <h5 className="text-lg font-semibold text-gray-900 mb-4">
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
                            return (
                              <div
                                key={check.label}
                                className={`rounded-lg border p-4 ${
                                  passed || semanticPass
                                    ? "border-green-200 bg-green-50"
                                    : warning
                                      ? "border-amber-200 bg-amber-50"
                                      : "border-red-200 bg-red-50"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-semibold text-gray-900">
                                    {check.label}
                                  </span>
                                  <span
                                    className={`text-xs font-bold uppercase ${
                                      passed || semanticPass
                                        ? "text-green-700"
                                        : warning
                                          ? "text-amber-700"
                                          : "text-red-700"
                                    }`}
                                  >
                                    {passed || semanticPass
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
                      {signerList.length > 0 && (
                        <div className="border-b border-gray-100">
                          <button
                            onClick={() => toggleSection(index, "signer")}
                            className="w-full px-6 py-4 text-left hover:bg-gray-50 transition-colors duration-200 focus:outline-none focus:bg-gray-50"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3">
                                <span className="text-xl">📇</span>
                                <h5 className="text-lg font-semibold text-gray-900">
                                  Signer Information
                                </h5>
                              </div>
                              <svg
                                className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                                  collapsedSections[`${index}-signer`]
                                    ? "transform rotate-180"
                                    : ""
                                }`}
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
                            </div>
                          </button>
                          {!collapsedSections[`${index}-signer`] && (
                            <div className="px-6 pb-6 space-y-4">
                              {signerList.map((signer, signerIdx) => (
                                <div
                                  key={signer.key}
                                  className="border border-gray-200 rounded-lg p-4"
                                >
                                  <p className="text-sm font-semibold text-gray-900 mb-3">
                                    {signerIdx + 1}. {signer.name}
                                    {signer.email ? ` <${signer.email}>` : ""}
                                  </p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {[
                                      ["Country", signer.country],
                                      ["State", signer.state],
                                      ["Locality", signer.locality],
                                      ["IP Address", signer.ip],
                                      ["Signed At", signer.signedAt]
                                    ]
                                      .filter(([, value]) => value)
                                      .map(([label, value]) => (
                                        <div
                                          key={label}
                                          className="bg-gray-50 rounded-lg p-4"
                                        >
                                          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                                            {label}
                                          </span>
                                          <p className="mt-1 text-sm font-mono text-gray-900 break-all">
                                            {value}
                                          </p>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Issuer Information Section */}
                      {Object.keys(issuerInfo).length > 0 && (
                        <div className="border-b border-gray-100">
                          <button
                            onClick={() => toggleSection(index, "issuer")}
                            className="w-full px-6 py-4 text-left hover:bg-gray-50 transition-colors duration-200 focus:outline-none focus:bg-gray-50"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3">
                                <span className="text-xl">🏢</span>
                                <h5 className="text-lg font-semibold text-gray-900">
                                  Issuer Details
                                </h5>
                              </div>
                              <svg
                                className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                                  collapsedSections[`${index}-issuer`]
                                    ? "transform rotate-180"
                                    : ""
                                }`}
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
                            </div>
                          </button>
                          {!collapsedSections[`${index}-issuer`] && (
                            <div className="px-6 pb-6">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {Object.entries(issuerInfo).map(
                                  ([label, value]) => (
                                    <div
                                      key={label}
                                      className="bg-gray-50 rounded-lg p-4"
                                    >
                                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                                        {label}
                                      </span>
                                      <p className="mt-1 text-sm font-mono text-gray-900 break-all">
                                        {value}
                                      </p>
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Certificate Validity Section */}
                      {res.certificateValidity && (
                        <div className="p-6 bg-gray-50">
                          <div className="flex items-center space-x-3 mb-4">
                            <span className="text-xl">🕒</span>
                            <h5 className="text-lg font-semibold text-gray-900">
                              Certificate Validity
                            </h5>
                          </div>
                          <div className="bg-white rounded-lg p-4 border">
                            <div className="flex items-center space-x-2">
                              <span
                                className={`text-lg ${isCertificateValid(res.certificateValidity) ? "text-green-600" : "text-red-600"}`}
                              >
                                {isCertificateValid(res.certificateValidity)
                                  ? "✅"
                                  : "❌"}
                              </span>
                              <span className="text-sm font-mono text-gray-900">
                                {res.certificateValidity}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Technical Details Section (if any) */}
                      {(res.calculatedDocumentHash ||
                        res.messageDigestInSignature ||
                        res.hashComparisonResult ||
                        res.authenticatedAttributesSignatureResult ||
                        res.errorDetails ||
                        res.certificateSubject ||
                        res.certificateIssuer) && (
                        <div className="p-6 bg-gray-50 border-t">
                          <details className="group">
                            <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                              <span>🔧 Technical Details</span>
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
                            <div className="mt-4 space-y-3">
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
              </div>
            )}
          </div>
        )}
      {verificationResult === t("verification-in-progress") && (
        <div className="mt-8 p-4 border border-base-300 rounded-lg bg-base-200 min-h-[100px] flex justify-center items-center">
          <span className="loading loading-lg loading-dots"></span>
        </div>
      )}

      {!verificationResult && !selectedFile && (
        <div className="mt-8 p-4 border border-base-300 rounded-lg bg-base-200 min-h-[100px] flex justify-center items-center">
          {" "}
          {/* Added flex for centering */}
          <p className="text-base-content/60 italic text-center">
            {t("verification-results-will-appear-here")}
          </p>
        </div>
      )}
    </div>
  );
};

export default VerifyDocument;
