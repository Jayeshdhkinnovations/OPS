# Signature Verification — Phase 2 Plan

Status: Phase 1 is implemented and tested. Phase 2 engineering implementation and deterministic local testing are complete for the current one-platform-signature architecture. Production activation remains gated on external trust anchors, an approved TSA, real-CA revocation interoperability testing, stale PFX_BASE64 cleanup, and staging deployment regression. See PHASE2_IMPLEMENTATION_TEST_REPORT.md.

Implemented in the first Phase 2 slice:

- the signing path parses the selected PFX and rejects expired or not-yet-valid signing certificates before creating a cryptographic signature;
- the fallback keystore has an automated validity test;
- the verifier reports Certificate Trust separately from integrity, cryptographic validity, and certificate dates;
- self-signed certificates are explicitly reported as self_signed rather than trusted;
- the trust evaluator supports configured PKI.js trust anchors and distinguishes trusted, self_signed, chain_valid_untrusted_root, chain_error, and unknown;
- Phase 1 verification regressions and the frontend production build pass.

Still required: deployment cleanup of any stale PFX_BASE64 value, production trust-anchor configuration, signer-authentication evidence, revision-permission validation, timestamps, revocation, audit-manifest protection, and protected identifier cross-checking.

Scope: certificate trust, signer-authentication evidence, multi-signature and incremental-revision validation, trusted timestamps, revocation, audit-trail integrity, and post-signing change detection. The Certificate of Completion layout in apps/OpenSignServer/cloud/parsefunction/pdf/GenerateCertificate.js is separate and must remain unaffected.

---

## 0. Verified current state and prerequisites

Phase 1 already provides separate results for:

1. Document Integrity
2. Cryptographic Signature
3. Certificate Status

The Phase 1 test coverage includes:

- untouched signed PDF: integrity PASS and signature PASS;
- tampered signed content: integrity FAIL and signature FAIL;
- bytes appended after the signed revision: integrity FAIL while the original cryptographic signature can still PASS;
- unsigned PDF: no signature found;
- an untouched PDF signed with the expired fallback certificate: integrity PASS, signature PASS, and certificate status EXPIRED.

This separation is intentional. An expired certificate does not prove that a document was modified, and an intact document does not make an expired certificate valid.

### 0.1 Certificate configuration must be corrected before deployment

The newly added apps/OpenSignServer/keystore_681.pfx is currently valid from 25 Aug 2026 through 22 Aug 2036 and is self-signed with a 2048-bit RSA key.

However, PDF.js loads certificates in this order:

1. tenant PFX;
2. PFX_BASE64 environment value;
3. apps/OpenSignServer/keystore_681.pfx fallback file.

A stale PFX_BASE64 value can therefore override the new fallback file. The deployment configuration must remove or replace any old expired PFX_BASE64 value before verification or signing tests are treated as representative.

Add a pre-sign certificate check in the server signing path:

- parse the selected certificate before signing;
- reject a certificate that is not yet valid or is expired;
- return a clear configuration error;
- never create a newly signed document with a known-invalid certificate.

Tests must cover valid, expired, and not-yet-valid certificates.

### 0.2 Immediate key-management baseline

Even though HSM or vault-backed private keys remain Phase 3 work, basic private-key protection is not optional:

- do not commit production PFX files, passwords, or PFX_BASE64 values to source control;
- store signing secrets in the deployment secret manager;
- restrict read access to the signing service;
- document key rotation and certificate replacement;
- keep only non-production test certificates in fixtures.

---

## 1. Final verification result model

The verification page must report independent evidence instead of reducing everything to one Valid or Invalid badge.

| # | Result | Question answered |
|---|---|---|
| 1 | Document Integrity | Are the bytes covered by the signature unchanged? |
| 2 | Cryptographic Signature | Does the CMS signature verify with the embedded signer certificate? |
| 3 | Certificate Validity | Was the certificate within its validity period at the relevant time? |
| 4 | Certificate Trust | Does the certificate chain terminate at a configured trusted root? |
| 5 | Revocation | Was the certificate revoked according to OCSP or CRL evidence? |
| 6 | Trusted Timestamp | Is there a valid RFC 3161 timestamp proving when the signature existed? |
| 7 | Signer Authentication | What evidence links the application user or recipient to the signing action? |
| 8 | Audit Trail Integrity | Has the event history remained unchanged since completion? |
| 9 | Revision Permissions | Were later PDF changes authorized by the certification and field permissions? |

The UI may show an overall conclusion, but it must be derived from and displayed alongside these individual results. Unknown, unavailable, self-signed, expired, and failed are distinct states and must not be collapsed together.

---

## 2. Certificate trust and chain validation

### Goal

Determine whether the embedded signing certificate is self-signed, chains to a configured trust anchor, chains correctly but ends at an untrusted root, or has a broken chain.

### Implementation

Extend apps/OpenSign/src/utils/pdfSignatureVerification.mjs with pure certificate-analysis helpers and keep them separate from CMS signature verification.

Validate:

- issuer and subject linkage for every certificate in the chain;
- each certificate signature;
- intermediate and root validity periods;
- Basic Constraints and CA flags;
- Key Usage and Extended Key Usage appropriate to document signing;
- supported signature algorithms and minimum key strength;
- chain termination against a maintained trust-anchor bundle;
- certificate validity at the trusted signing time when one is available, otherwise at the current verification time.

Return explicit statuses such as:

- trusted;
- self_signed;
- chain_valid_untrusted_root;
- chain_error;
- expired;
- not_yet_valid;
- unsupported_algorithm.

A self-signed certificate can produce a mathematically valid document signature but must not be described as publicly trusted.

### Trust-store requirements

A Mozilla-derived root bundle alone is not sufficient for every document-signing deployment. The system must define which public and private enterprise roots are trusted, how they are updated, and how tenant-specific roots are handled.

Do not use a Let's Encrypt TLS certificate as the positive document-signing test fixture. Use a purpose-built document-signing test CA with the correct key usages.

### Tests

- current self-signed SignToowix test PFX reports self_signed;
- a certificate issued by the test document-signing CA reports trusted when its root is configured;
- the same chain reports chain_valid_untrusted_root when its root is absent;
- broken intermediate, wrong key usage, weak key, expired intermediate, and unsupported algorithm cases fail with precise statuses.

---

## 3. Signer-authentication evidence

### Goal

Report what application evidence links a participant to the signing action. Cryptographic verification of the platform PDF signature does not by itself prove that each visible participant personally controlled the signing key.

### Evidence model

For every participant, record and verify where available:

- recipient identifier and signing order;
- normalized email address;
- authentication method, such as email link, OTP, SSO, or another configured factor;
- authentication outcome and timestamp;
- viewed and signed timestamps;
- test or recorded IP address;
- user-agent or session identifier where policy permits;
- relevant document and transaction identifiers.

Authentication evidence must be linked to the protected audit manifest described in Section 7. It must not be accepted only because editable database fields currently contain matching text.

### Result states

- verified;
- partially_verified;
- unavailable;
- inconsistent;
- failed.

The UI must describe the evidence actually present and must not turn email-link access into a stronger identity claim than it supports.

### Tests

- participant with matching OTP or SSO evidence;
- participant with email-link-only evidence;
- missing authentication event;
- signer email or identifier changed after completion;
- event timestamp or IP changed after completion.

---

## 4. Multi-signature revisions and post-signing changes

### Architecture decision required first

The current SignToowix workflow must not be assumed to contain one independent PDF cryptographic signature per visible participant. In the observed flow, participant signature fields and audit events can be followed by one final platform CMS/PFX signature.

Therefore, the existing three-participant fixture proves the participant workflow and final platform signature, but it does not prove validation of three independent cryptographic PDF signatures.

Before implementing multi-signature verification, confirm which model is intended:

1. one final platform cryptographic signature protecting all participant evidence; or
2. a separate PDF cryptographic signature and incremental revision for every participant.

If model 1 remains the product architecture, report one cryptographic signature plus participant authentication and audit evidence. Do not label visible signature images as separate cryptographic signatures.

If model 2 is adopted, signing logic must create and preserve a valid incremental PDF revision for each signer.

### Revision validation

For every actual PDF signature dictionary:

- parse and validate all ByteRange values;
- reject negative, overlapping, out-of-bounds, or malformed ranges;
- identify the exact signed revision boundary;
- verify the CMS signature over that revision;
- order signatures by revision boundary;
- ensure later revisions append correctly and do not rewrite earlier signed bytes;
- inspect DocMDP and FieldMDP transform parameters;
- determine whether each later change is permitted, unauthorized, or indeterminate;
- verify that the final expected signature covers the intended final revision.

Do not use a heuristic that expects one signer's signed revision length to equal another signer's revision length. Incremental revisions normally end at different offsets.

### Result states

- permitted;
- unauthorized_change;
- malformed_revision;
- final_revision_not_covered;
- not_applicable;
- unknown.

### Tests

- genuine fixture containing at least three independent PDF signatures, if model 2 is implemented;
- valid later signature accepted under DocMDP or FieldMDP;
- earlier signed bytes modified;
- unauthorized annotation or page-content change;
- malformed or overlapping ByteRange;
- extra bytes appended after the final expected signature;
- current one-platform-signature workflow correctly reports multi-signature validation as not_applicable rather than pretending there are three cryptographic signatures.

---

## 5. RFC 3161 trusted timestamps

### Goal

Provide independent evidence that a signature existed at a specific time and allow certificate validity to be evaluated at that trusted time.

### Signing-time flow

1. Create the CMS signature.
2. Hash the CMS signature value using the configured digest algorithm.
3. Build an RFC 3161 timestamp request containing that message imprint and a nonce.
4. Send it to a configured TSA over a server-side connection.
5. Validate the TSA response status, nonce, message imprint, algorithm, and token signature.
6. Add the timestamp token to the CMS unsigned attributes.
7. Ensure the PDF signature placeholder reserves enough capacity for the timestamped CMS container.

The request belongs in the server signing path. It cannot be added reliably after the completed signature has already been embedded without planning the placeholder and unsigned attributes.

### Verification-time flow

Validate:

- timestamp-token CMS signature;
- TSA certificate chain and relevant timestamping EKU;
- message imprint against the document signature value;
- nonce or request correlation where retained;
- timestamp date against signer-certificate validity;
- token structure and supported algorithms.

Return trusted, invalid, unavailable, or unsupported.

### Availability policy

A free public TSA may be used only for isolated development testing. Production requires an approved provider and an explicit fail-open or fail-closed signing policy. TSA outages must never be silently treated as a valid timestamp.

### Tests

- valid test TSA token;
- modified timestamp token;
- token with the wrong message imprint;
- untrusted or expired TSA certificate;
- TSA timeout;
- insufficient PDF signature placeholder;
- signing behaviour under the configured fail-open and fail-closed policies.

---

## 6. Revocation through OCSP and CRL

### Goal

Determine whether a certificate was revoked while avoiding unsafe browser calls and unsafe server-side URL fetching.

### Implementation

Add a server-side verification module, for example apps/OpenSignServer/cloud/parsefunction/pdf/VerifyOCSP.js, and expose a narrowly scoped backend endpoint.

The endpoint must:

- accept only parsed certificate and issuer data needed for the check, or a bounded signed-PDF upload;
- read OCSP and CRL distribution points from the certificate;
- prefer OCSP when supported and use CRL as a controlled fallback;
- verify OCSP responder signatures and CRL signatures;
- validate response freshness and thisUpdate or nextUpdate;
- cache bounded responses by issuer and serial number;
- return good, revoked, unknown, unavailable, or malformed separately.

### Network-security controls

Certificate-provided URLs are untrusted input. Add SSRF protections:

- allow only approved HTTP or HTTPS schemes;
- resolve hostnames and reject loopback, link-local, private, multicast, and metadata-service destinations;
- re-check resolved destinations after redirects;
- enforce short connection and total timeouts;
- limit redirects, response size, and decompression;
- parse responses defensively;
- never convert network failure into good status.

### Tests

- known-good development certificate;
- known-revoked test certificate;
- unknown responder result;
- stale OCSP response;
- invalid responder signature;
- CRL fallback;
- timeout and malformed response;
- private-address and redirect-based SSRF attempts are blocked.

Real-CA interoperability testing is required before production release.

---

## 7. Audit-trail integrity

### Goal

Make later modification of the completion history detectable.

A hash chain stored beside the editable JSON audit array in the same database is not sufficient by itself. An attacker who can rewrite the audit array may also rewrite the unanchored hash values.

### Protected audit manifest

At completion:

1. Canonicalize each audit event using a versioned schema and deterministic serialization.
2. Include event ID, sequence, type, participant ID, authentication evidence reference, timestamp, IP where retained, document ID, transaction ID, and previous-event hash.
3. Hash each canonical event to build a chain or Merkle structure.
4. Create a final manifest containing the ordered event hashes and the final root.
5. Anchor that root in evidence the same attacker cannot freely rewrite:
   - embed it in the final platform-signed PDF or its signed CMS attributes;
   - and, when available, cover it with the trusted timestamp;
   - optionally also write it to an append-only external log.
6. Store the canonicalization version and algorithm identifiers.

At verification, rebuild the manifest, compare the root with the signed anchor, and identify missing, reordered, modified, or inserted events.

### Compatibility

Legacy documents without a protected manifest must report unavailable, not failed or valid. The Certificate of Completion can display identifiers and hashes, but merely printing them does not protect the underlying records.

### Tests

- untouched event sequence;
- event text or timestamp modified;
- event deleted;
- event inserted;
- events reordered;
- participant identity changed;
- both database events and database-side hashes rewritten while the signed PDF anchor remains unchanged;
- legacy document without a manifest.

Because this changes the live document-completion path, it requires a dedicated regression pass rather than being bundled casually with UI-only changes.

---

## 8. Identifiers and certificate cross-checking

The Certificate of Completion may show Certificate ID, Transaction ID, document hash, and a QR target. The standalone signed PDF does not necessarily contain every one of these identifiers in cryptographically protected form.

Choose one of these designs:

- embed the identifiers in the final signed PDF or signed audit manifest; or
- resolve them through an authenticated backend verification record keyed by a protected transaction identifier.

Verification must not claim that identifiers match merely because two editable displays show the same values.

Tests must cross-check:

- document ID;
- transaction ID;
- certificate ID;
- document hash;
- QR verification target;
- completion timestamp;
- participant ordering.

---

## 9. Recommended implementation order

| Order | Work item | Reason |
|---|---|---|
| 1 | Fix PFX_BASE64 deployment precedence and add pre-sign certificate validity enforcement | Prevents new documents from being signed with a known-invalid certificate |
| 2 | Add certificate trust and chain reporting | Pure verification work with no external service dependency |
| 3 | Define and protect signer-authentication evidence | Clarifies what the platform can truthfully prove for each participant |
| 4 | Decide the one-platform-signature versus per-signer-signature architecture | Prevents implementing revision logic against a false assumption |
| 5 | Implement revision and DocMDP or FieldMDP validation for the chosen model | Detects unauthorized post-signing changes without rejecting permitted signatures |
| 6 | Implement a test-grade RFC 3161 timestamp end to end | Requires signing-path and PDF placeholder work |
| 7 | Implement OCSP and CRL with SSRF controls and real-CA interoperability tests | External dependencies and false-result risk require broader testing |
| 8 | Implement signed audit-manifest protection in a separate completion-flow change | Highest regression risk because it changes live completion behaviour |
| 9 | Select and configure a production TSA and production trust policy | Vendor and deployment decision |

---

## 10. Automated and manual testing

### 10.1 Preserve Phase 1 regression coverage

Continue running:

- untouched signed PDF;
- tampered signed content;
- appended bytes;
- unsigned PDF;
- expired-certificate but untouched PDF.

The expired fixture must continue to show integrity PASS, cryptographic signature PASS, and certificate validity EXPIRED.

### 10.2 Phase 2 component tests

Add isolated fixtures and tests for:

- trusted, self-signed, untrusted-root, and broken certificate chains;
- signer-authentication evidence states;
- revision and permission validation;
- timestamp verification;
- OCSP and CRL;
- protected audit manifests;
- identifier cross-checking.

Every check needs a positive, negative, malformed-input, and unavailable-evidence case where applicable.

### 10.3 Combined report test

A fully valid fixture should report all nine evidence rows independently:

1. Document Integrity
2. Cryptographic Signature
3. Certificate Validity
4. Certificate Trust
5. Revocation
6. Trusted Timestamp
7. Signer Authentication
8. Audit Trail Integrity
9. Revision Permissions

Negative fixtures must fail only the relevant row when separation is meaningful. For example, an expired but untouched document must not be reported as tampered.

### 10.4 Full workflow regression

In a non-production test environment, verify:

- document creation;
- recipient assignment;
- viewing and signing in order;
- final completion only after all recipients sign;
- final signed document generation;
- Certificate of Completion generation;
- email notifications;
- verification upload;
- QR and identifier resolution;
- one-participant, three-participant, long-data, and multi-page cases.

Open and visually inspect the final signed PDF and Certificate of Completion. Confirm signatures, participants, timestamps, IP values, audit events, identifiers, hashes, and completion status are present and readable.

### 10.5 Deployment gate

Run all automated and workflow tests before deployment. Then rebuild the image, deploy first to a non-customer environment, run health and verification checks, and only then promote through the normal release process.

Do not copy untested files directly into a live customer-facing container as a substitute for the release process.

---

## 11. Out of scope for Phase 2

The following remain Phase 3 or later:

- HSM-backed or managed-KMS signing operations;
- long-term validation packaging such as PAdES-LT or PAdES-LTA;
- automated certificate-expiry monitoring and alerting;
- formal downloadable verification reports;
- production trust-policy governance and compliance certification.

This does not defer basic secret hygiene, pre-sign certificate validation, or accurate reporting. Those are prerequisites for safely shipping Phase 2.

---

## 12. Phase 2 acceptance criteria

Phase 2 is complete only when:

- all evidence results are independent and accurately named;
- trust is not confused with cryptographic validity;
- self-signed certificates are never presented as publicly trusted;
- signer authentication claims match the actual evidence collected;
- multi-signer reporting matches the real signing architecture;
- later revisions are evaluated through ByteRange and DocMDP or FieldMDP rules;
- timestamps are cryptographically verified, not trusted from a plain date field;
- OCSP and CRL failures are not treated as good, and SSRF protections are tested;
- the audit-trail root is anchored in signed or append-only evidence;
- identifier matching is cryptographically protected or verified by an authenticated backend record;
- the existing Phase 1 regression suite remains green;
- the signing and Certificate of Completion flows remain unchanged except for explicitly approved Phase 2 functionality.
