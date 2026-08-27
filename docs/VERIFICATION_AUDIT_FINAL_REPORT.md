# SignToowix Document Verification — Final Audit Report

Date: 2026-08-26
Scope: `VerifyDocument.jsx`, `pdfSignatureVerification.mjs`, `PDF.js`,
`Placeholder.js`, `SigningCertificate.js`, `VerificationEvidence.js`,
`ExternalCertificateValidation.js`, `verifyCertificateEvidence.js`,
`GenerateCertificate.js`, and the automated test suites for all of the above.
Code-change status: **no application code was changed by this report.**
New files added: one automated test suite that closes a coverage gap
(`apps/OpenSignServer/spec/verification-audit-gaps.mjs`) and one runner
script (`scripts/run-verification-audit.mjs` + its `npm run
audit:verification` entry point). Nothing else was touched.

This report does three things:
1. Confirms — by tracing the code and executing it, not by reading comments
   — what Phase 1 and Phase 2 actually implement today.
2. Independently verifies the most severe claim in the existing
   `audit-reports/verification-audit-corrected-2026-08-26.md` report against
   the live code, and adopts that report's findings (they check out).
3. Adds the missing automated coverage that report itself flagged as broken
   (`OCSP/CRL/malformed-gap suite: PARTIAL / HARNESS FAIL`), and wires
   everything into one repeatable command.

---

## 1. Ground-truth evidence key

Every claim below is tagged with how it was established:

- **RUNTIME VERIFIED** — executed just now, output shown in this report.
- **CODE TRACED** — read the exact lines that implement or fail to
  implement the behavior; file:line given.
- **CODE EXISTS** — a control exists in source but no test in this repo
  currently exercises it end-to-end.
- **NOT IMPLEMENTED** — confirmed absent by tracing, not by absence of
  a keyword match.

---

## 2. The one command

```bash
npm run audit:verification        # from the repo root
```

This runs, in order, and fails loudly if any step fails:

1. `apps/OpenSignServer`: `test:signing-certificate` — PFX date/corruption
   validation (RUNTIME VERIFIED, passing).
2. `apps/OpenSignServer`: `test:phase2-security` — trust chain, audit
   hash-chain, RFC 3161, OCSP, all against real self-issued certificates and
   real cryptographic round-trips, not internal-logic mocks (RUNTIME
   VERIFIED, passing).
3. `apps/OpenSignServer`: `test:verification-audit-gaps` — **new**, added by
   this audit (RUNTIME VERIFIED, passing; see §5).
4. `apps/OpenSignServer`: `test:three-signer-e2e` — full
   create→sign→sign→sign→complete→certificate workflow against the real
   `PDF.js`/`GenerateCertificate.js` code (RUNTIME VERIFIED, passing).
5. `apps/OpenSign`: `test:verification` — Phase 1 tamper-detection suite
   (RUNTIME VERIFIED, passing).
6. Whole-repo static architecture/secret scan
   (`scripts/verification-audit.mjs`, pre-existing) — pattern-based, not a
   substitute for 1-5, kept for drift detection. Latest run: **3 CRITICAL,
   7 HIGH, 4 MEDIUM, 0 LOW** (RUNTIME VERIFIED just now; report saved under
   `audit-reports/`).

Run it after any change to the files in scope. A clean run of steps 1-5
plus a stable/expected finding count in step 6 is the bar for "did not
regress."

---

## 3. Phase 1 status

| Feature | Status | Evidence |
|---|---|---|
| ByteRange structural validation | PASS | CODE TRACED + RUNTIME VERIFIED (malformed/overlapping ByteRange rejected in §5) |
| CMS/PKCS#7 parsing | PASS | CODE TRACED (`pdfSignatureVerification.mjs:603-628`) |
| Actual cryptographic signature verification (not just date check) | PASS | RUNTIME VERIFIED — tampered-byte and corrupted-CMS fixtures both correctly FAIL (`pdfSignatureVerification.mjs:723-733`, §5) |
| Document Integrity / Cryptographic Signature / Certificate Status reported independently | PASS | RUNTIME VERIFIED, three distinct fields in every result |
| Expired fallback certificate replaced | PASS | RUNTIME VERIFIED — new self-signed cert valid 2026-08-25→2036-08-22 |
| Server refuses to sign with an expired/not-yet-valid certificate | PASS | RUNTIME VERIFIED (`test:signing-certificate`) |

**Gap carried over from the last review:** the expired-certificate-but-
untouched-document test case (proving Document Integrity and Certificate
Status are reported independently on a real expired-cert fixture) is still
skipped — no deterministic fixture signed with the old expired PFX exists.
Not a regression, just still open.

---

## 4. Phase 2 status — broader than previously reported

Tracing the code surfaced substantially more than the trust-status slice
that was reported to me earlier in this conversation. What actually exists
today:

| Feature | Status | Evidence |
|---|---|---|
| Certificate trust/chain evaluation (trusted/self-signed/untrusted-root/chain-error) | PASS | RUNTIME VERIFIED against a real self-issued CA+leaf pair, both the trusted and untrusted-root paths (`phase2-security.mjs`) |
| OCSP checking | PASS (mechanism); PARTIAL (production readiness) | RUNTIME VERIFIED good/revoked/forged-signature/unreachable, all against a real signed OCSP response (§5). Not yet tested against a real-world CA's live responder. |
| CRL checking | PASS (mechanism); PARTIAL (production readiness) | RUNTIME VERIFIED good/revoked/forged-signature (§5). Same production caveat as OCSP. |
| SSRF hardening on the OCSP/CRL fetcher | PASS | RUNTIME VERIFIED: private IPv4, private IPv6 (ULA), credential-bearing URLs, non-HTTP(S) schemes, and URLs not advertised by the certificate are all rejected (§5) |
| RFC 3161 trusted timestamp | PASS (mechanism); PARTIAL (production readiness) | RUNTIME VERIFIED against a real self-signed TSA; no production/paid TSA wired in yet (by design — vendor decision, correctly deferred) |
| Audit-trail hash-chain manifest, embedded and signed with the document | PASS | RUNTIME VERIFIED: manifest is embedded in the PDF catalog *before* the placeholder/signature are added (`PDF.js:380`), so it is inside the cryptographically signed byte range, not a free-standing sidecar. Forging it and re-saving breaks verification (§5, new test). |
| DocMDP declaration | CODE EXISTS, architecturally moot for the current design | The platform applies exactly **one** PDF signature per document, at final completion (confirmed: a real 3-signer fixture has exactly one `PDFSignature` field, named `Signature1`). So per-signer DocMDP conflicts (which would be a real problem if each signer got their own PKI signature) do not apply to the current `single_platform_signature` architecture. |
| Protected identifier (Certificate ID / Transaction ID) self-consistency | PASS | RUNTIME VERIFIED end-to-end (`three-signer-workflow.mjs`) — the DB-stored IDs, the manifest's IDs, and the completion certificate's independently-recomputed IDs all agree. **Caveat:** the formula is duplicated by hand in three places (`VerificationEvidence.js`, `GenerateCertificate.js`, `pdfSignatureVerification.mjs`) with no shared source — currently correct, but nothing would catch future drift between them except this end-to-end test. |

---

## 5. What this audit added: the missing automated coverage

The pre-existing `audit-reports/verification-audit-corrected-2026-08-26.md`
report already found and manually verified almost everything above, and its
own §J states plainly: *"OCSP/CRL/malformed-gap suite: PARTIAL / HARNESS
FAIL... the script exited 1 only because its final raw-regex
evidence-removal step assumes an uncompressed PDF literal; pdf-lib stored
evidence in an object stream."*

I hit the exact same wall independently while building
`apps/OpenSignServer/spec/verification-audit-gaps.mjs` — confirmed the PDF
catalog (where the evidence manifest and `/Perms` live) is compressed into
an object stream by pdf-lib's default save, while `/ByteRange` and
`/Contents` are deliberately kept as raw, patchable bytes by the signing
placeholder. Once I understood that, this file was rewritten to edit the
evidence through pdf-lib's object model instead of raw-byte-splicing, and
now runs cleanly. It closes these previously-broken/missing checks, all
**RUNTIME VERIFIED just now**:

- OCSP: good / revoked / signed-by-an-unrelated-key ("malformed") /
  unreachable-responder-degrades-to-"unavailable" (never silently "good").
- CRL: good / revoked / signed-by-an-unrelated-key.
- The "responder URL must be advertised by the certificate itself" guard in
  `verifyCertificateEvidence.js` — rejects an attacker-supplied URL (tested
  against the classic `169.254.169.254` cloud-metadata SSRF target) even
  with an otherwise-valid certificate pair.
- Malformed ByteRange (non-numeric, overlapping), empty `/Contents`,
  non-hexadecimal `/Contents`, corrupted CMS DER (flipped inside the actual
  signature tail, not a random offset), and a truncated file — all rejected
  without throwing uncaught or reporting PASS.
- **The single most important new test**: forging the embedded
  verification-evidence manifest (changing a participant's name) and
  re-saving the PDF breaks both `documentIntegrityStatus` and
  `cryptographicSignatureStatus` (surfaces as a structural `error` result
  post-resave, which is a correct, non-crashing rejection, not a false
  PASS). This is direct proof — not an assumption — that the audit trail
  is cryptographically bound to the document, not a trustable-on-its-own
  sidecar.

---

## 6. Independent confirmation of the corrected report's top finding

Rather than re-deriving all ~24 findings in the existing corrected report
from scratch (it is already thorough and dated today), I spot-verified its
single most severe claim directly against the live code, since it is the
one that most changes the production-readiness verdict:

> **C-1 — the server signs whatever PDF bytes the client's final signing
> request contains, with no comparison against a server-held prior
> revision or hash.**

CODE TRACED, confirmed exactly as described:
`apps/OpenSignServer/cloud/parsefunction/pdf/PDF.js:465-467`:
```js
if (req.params.pdfFile) {
  let PdfBuffer = Buffer.from(req.params.pdfFile, 'base64');
```
There is no fetch-and-compare against `_resDoc.SignedUrl` (the document's
last known signed revision), no expected-hash parameter, and no
compare-and-swap. Everything downstream — the audit trail, the
verification-evidence manifest, the platform signature — is built
faithfully on top of whatever bytes arrived in this one request. This
means the strong guarantee this whole Phase 1/2 effort built
("document integrity" = "unchanged since the platform signed it") is real
and proven, but it is silent on a logically prior question the audit was
implicitly also being asked to answer: "is this the same content every
signer actually saw?" That question is not yet answered by anything in
this codebase. I confirm this is accurately described in the existing
report and should be treated as the top production-readiness blocker, not
something this Phase 1/2 work already covers.

The rest of that report's findings (weak/unbound signer authentication,
the fallback PFX's private key and hardcoded `'opensign'` passphrase being
repository-committed, ByteRange accepting shapes beyond a strict 4-value
array, the QR/certificate-ID lookup route not existing yet, trust-anchor
config being Vite build-time and not proven wired into the Docker build,
same-tenant authorization gaps on `getDocument`/`triggerEvent`) read as
consistent with what I traced while building the dependency map for this
report, and I did not find anything that contradicts them. I did not
re-verify each one by independent execution — treat those as **CODE
TRACED by the prior report, spot-checked for consistency by this one**,
one level below the items in §5 that I personally re-derived and ran.

---

## 7. Security findings requiring attention (adopted from the corrected report, confirmed consistent)

| Severity | Finding | Status |
|---|---|---|
| CRITICAL | Server signs untrusted client-supplied final PDF bytes with no revision compare-and-swap | **CONFIRMED** (§6, direct code trace) |
| CRITICAL | Signing identity not cryptographically/authoritatively bound to the requested participant; legacy OTP is weak (4-digit, `Math.random`, no expiry/throttling/binding) | Consistent with code structure observed; not independently re-executed |
| CRITICAL | Fallback signing private key (`keystore_681.pfx`) and its hardcoded `'opensign'` passphrase are repository-committed | **CONFIRMED** — `PDF.js:469,506` hardcode `'opensign'`; `keystore_681.pfx` is a tracked file in git history |
| HIGH | Participants don't get individual cryptographic signatures — one platform signature covers the whole completed document | **CONFIRMED** — a real 3-signer fixture has exactly one `PDFSignature` field |
| HIGH | ByteRange accepts any even-length ≥4 array, not strictly 4 values, and doesn't bind the excluded gap to the literal `/Contents` token | Consistent with `parseByteRange` (`pdfSignatureVerification.mjs:530-582`) — not independently exploited |
| HIGH | QR/certificate-ID verification route doesn't read `certId` and sits behind an authenticated layout | Not independently re-checked this session |
| HIGH | DocMDP/FieldMDP incremental-revision semantics are only coarsely classified | Consistent with `revisionPermissionsStatus` logic traced in §4 |
| HIGH | Trust-anchor / TSA config may not actually be wired into the built Docker image per-tenant | Not independently re-checked this session |
| HIGH | Same-tenant endpoints use master-key access without binding caller to signer/document | Not independently re-checked this session |
| HIGH | OCSP/CRL lack freshness checks (`thisUpdate`/`nextUpdate`), real-CA interop testing | Consistent with what §5's tests do and don't cover |
| MEDIUM×10 | See the corrected report §D for the full list (timestamp scope, evidence semantic trust, stored-hash not cross-checked by the standalone verifier, certificate selection ambiguity, memory use on large files, ID collision-resistance framing, etc.) | Not re-derived; no contradiction found |

Full detail, impact, and fix guidance for every item above:
`audit-reports/verification-audit-corrected-2026-08-26.md`.

---

## 8. Test results (this session)

```
[PASS] Signing-certificate validation
[PASS] Phase 2 security suite (trust/audit-chain/RFC3161/OCSP)
[PASS] Verification audit gap suite (new: OCSP/CRL negative cases, SSRF, malformed PDF fuzz, evidence-forgery)
[PASS] Three-signer end-to-end workflow
[PASS] Phase 1 tamper-detection suite
[WARN] Static repo scan: 3 CRITICAL / 7 HIGH / 4 MEDIUM / 0 LOW (expected — matches known, not-yet-fixed architectural gaps in §7, not a new regression)
```

No test was edited to force a pass. Two real bugs were found and fixed
*in my own new test file* during this session (not in application code):
an OCSP/CRL "tamper" test that flipped a byte landing in unused certificate
padding rather than the signature value (silently proved nothing), and a
raw-string evidence-tamper test that couldn't find its target because the
PDF catalog is compressed. Both are called out explicitly here rather than
quietly fixed, since a test that passes for the wrong reason is worse than
one that fails honestly.

---

## 9. Production readiness

**READY WITH CONDITIONS** — for the narrow claim Phase 1/2 actually
proves: *"this exact signed file has not been altered since the platform's
final signature, and here is what we can and cannot say about who signed
it, when, and whether the certificate is trusted/revoked."* That claim is
now real, tested, and defensible, which it was not before this work.

**NOT READY** for the broader claim "this is a secure, complete document
verification system," per the corrected report's own conclusion, until the
three CRITICAL items in §7 are addressed — particularly the untrusted
client-bytes issue, since it undermines trust in *what* was signed, not
just whether the signature over it is mathematically valid.

## 10. Recommended next steps, in order

1. Fix C-1 (server-authoritative revision compare-and-swap before signing) —
   highest impact, and the one most likely to surprise a customer or
   auditor if left unaddressed.
2. Fix C-3 (rotate/remove the repository-committed fallback key and its
   hardcoded passphrase; move to a secret manager).
3. Fix C-2 (bind signing identity to the requested participant; replace the
   legacy 4-digit OTP).
4. Then work down the HIGH list in `audit-reports/verification-audit-corrected-2026-08-26.md`.
5. Re-run `npm run audit:verification` after each fix — it is now one
   command and will catch regressions in everything already proven working.
