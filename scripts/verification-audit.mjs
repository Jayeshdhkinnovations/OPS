#!/usr/bin/env node

/**
 * SignToowix / OpenSign verification audit runner
 *
 * Goals:
 *  - statically scan the verification implementation and all source/config files
 *  - flag missing/weak verification controls
 *  - inspect bundled signing certificates
 *  - optionally cryptographically verify a signed PDF with OpenSSL
 *  - optionally run a tamper test against the detached CMS signature
 *  - optionally run read-only production smoke checks
 *  - optionally run project lint/test/build commands
 *
 * This script is READ-ONLY with respect to production. It never mutates remote data.
 * Reports are written under ./audit-reports/.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const options = {
  pdf: [],
  baseUrl: null,
  deep: false,
  install: false,
  caFile: null,
  noTamper: false,
  verbose: false,
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--pdf') options.pdf.push(path.resolve(args[++i]));
  else if (arg === '--base-url') options.baseUrl = args[++i]?.replace(/\/+$/, '');
  else if (arg === '--deep') options.deep = true;
  else if (arg === '--install') options.install = true;
  else if (arg === '--ca-file') options.caFile = path.resolve(args[++i]);
  else if (arg === '--no-tamper') options.noTamper = true;
  else if (arg === '--verbose') options.verbose = true;
  else if (arg === '--help' || arg === '-h') {
    console.log(`
Usage:
  node scripts/verification-audit.mjs [options]

Options:
  --pdf <file>         Verify a signed PDF. Can be repeated.
  --base-url <url>     Add read-only production/staging smoke checks.
  --deep               Run available lint/test/build commands.
  --install            With --deep, run npm ci before commands.
  --ca-file <pem>      CA bundle for certificate-chain validation.
  --no-tamper          Skip automatic tamper test for supplied PDFs.
  --verbose            Print extra command output.
  --help               Show this help.

Examples:
  node scripts/verification-audit.mjs
  node scripts/verification-audit.mjs --pdf ./fixtures/signed.pdf
  node scripts/verification-audit.mjs --pdf ./signed.pdf --ca-file ./ca.pem
  node scripts/verification-audit.mjs --base-url https://sign.toowix.com
  node scripts/verification-audit.mjs --deep
`);
    process.exit(0);
  }
}

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, '-');
const reportDir = path.join(repoRoot, 'audit-reports');
await fsp.mkdir(reportDir, { recursive: true });
const reportJsonPath = path.join(reportDir, `verification-audit-${stamp}.json`);
const reportMdPath = path.join(reportDir, `verification-audit-${stamp}.md`);

const findings = [];
const checks = [];

function finding(severity, title, detail, file = null, evidence = null) {
  findings.push({ severity, title, detail, file, evidence });
}

function check(name, status, detail = '', extra = {}) {
  checks.push({ name, status, detail, ...extra });
}

function redact(value) {
  if (!value) return value;
  const s = String(value);
  if (s.length <= 8) return '[REDACTED]';
  return `${s.slice(0, 3)}…${s.slice(-3)}`;
}

function run(cmd, cmdArgs, cwd = repoRoot, env = process.env) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message,
  };
}

function exists(p) {
  return fs.existsSync(path.join(repoRoot, p));
}

function readRepoText(p) {
  return fs.readFileSync(path.join(repoRoot, p), 'utf8');
}

function lineOf(text, needle) {
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  return text.slice(0, idx).split('\n').length;
}

const ignoreDirs = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache',
  'exports', 'audit-reports', 'public/static',
]);

const textExtensions = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.html', '.css', '.scss',
  '.md', '.yml', '.yaml', '.toml', '.txt', '.env', '.sh', '.dockerfile', '.conf',
]);

function shouldIgnore(rel) {
  const normalized = rel.replaceAll('\\', '/');
  return [...ignoreDirs].some((d) => normalized === d || normalized.startsWith(`${d}/`) || normalized.includes(`/${d}/`));
}

async function walk(dir, root = dir, out = []) {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replaceAll('\\', '/');
    if (shouldIgnore(rel)) continue;
    if (entry.isDirectory()) await walk(abs, root, out);
    else out.push({ abs, rel });
  }
  return out;
}

function isTextFile(file) {
  const base = path.basename(file.rel).toLowerCase();
  const ext = path.extname(base);
  return textExtensions.has(ext) || base === 'dockerfile' || base.startsWith('.env');
}

function severityRank(s) {
  return ({ CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 })[s] || 0;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---------------------------
// 1) Whole-codebase static scan
// ---------------------------
const allFiles = await walk(repoRoot);
const textFiles = allFiles.filter(isTextFile);
let totalLines = 0;
let unreadableTextFiles = 0;
const secretHits = [];
const suspiciousSecretPatterns = [
  { name: 'Private key marker', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Hardcoded password-like assignment', re: /(?:password|passwd|passphrase|secret)\s*[:=]\s*["'][^"'\n]{6,}["']/gi },
  { name: 'JWT-like token', re: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
];

for (const file of textFiles) {
  try {
    const txt = await fsp.readFile(file.abs, 'utf8');
    totalLines += txt.split('\n').length;
    for (const p of suspiciousSecretPatterns) {
      const m = p.re.exec(txt);
      p.re.lastIndex = 0;
      if (m) {
        secretHits.push({ file: file.rel, type: p.name, line: lineOf(txt, m[0]) });
      }
    }
  } catch {
    unreadableTextFiles++;
  }
}

check('Repository file scan', 'PASS', `${allFiles.length} files discovered; ${textFiles.length} text/source/config files read; ${totalLines.toLocaleString()} lines scanned.`);
if (unreadableTextFiles) finding('LOW', 'Some text files could not be read', `${unreadableTextFiles} text-like files were unreadable.`);
if (secretHits.length) {
  finding('HIGH', 'Potential hardcoded secret material detected', `${secretHits.length} potential secret pattern(s) found. Values are intentionally not printed.`, null, secretHits);
} else {
  check('Secret-pattern scan', 'PASS', 'No obvious private-key/JWT/password literal patterns found in scanned text files.');
}

// ---------------------------
// 2) Verification architecture/static controls
// ---------------------------
const verifyFile = 'apps/OpenSign/src/pages/VerifyDocument.jsx';
const pdfFile = 'apps/OpenSignServer/cloud/parsefunction/pdf/PDF.js';
const certFile = 'apps/OpenSignServer/cloud/parsefunction/pdf/GenerateCertificate.js';
const genCertFile = 'apps/OpenSignServer/cloud/parsefunction/generateCertificatebydocId.js';
const editTemplateFile = 'apps/OpenSign/src/components/pdf/EditTemplate.jsx';

for (const required of [verifyFile, pdfFile, certFile, genCertFile]) {
  if (!exists(required)) finding('CRITICAL', 'Expected verification/signing file missing', required, required);
}

const verifySrc = exists(verifyFile) ? readRepoText(verifyFile) : '';
const pdfSrc = exists(pdfFile) ? readRepoText(pdfFile) : '';
const editTemplateSrc = exists(editTemplateFile) ? readRepoText(editTemplateFile) : '';
const genCertSrc = exists(genCertFile) ? readRepoText(genCertFile) : '';

const staticControls = [
  ['Signature-field discovery', /PDFSignature/, 'HIGH'],
  ['ByteRange parsing', /ByteRange/, 'CRITICAL'],
  ['Contents parsing', /Contents/, 'CRITICAL'],
  ['ASN.1 parsing', /asn1js\.fromBER/, 'HIGH'],
  ['CMS SignedData parsing', /new SignedData/, 'HIGH'],
  ['Signer certificate lookup', /signerCertificate/, 'HIGH'],
  ['Certificate notBefore check', /notBefore/, 'MEDIUM'],
  ['Certificate notAfter check', /notAfter/, 'MEDIUM'],
];
for (const [name, re, sev] of staticControls) {
  if (re.test(verifySrc)) check(name, 'PASS', `Found in ${verifyFile}.`);
  else finding(sev, `${name} not found`, `Expected control not found in ${verifyFile}.`, verifyFile);
}

const hasCryptoVerify = /signedData\s*\.\s*verify\s*\(/.test(verifySrc) || /\.verify\s*\(\s*\{[^}]*data:/s.test(verifySrc);
if (!hasCryptoVerify) {
  finding(
    'CRITICAL',
    'CMS signature is parsed but not cryptographically verified in VerifyDocument',
    'The page reconstructs ByteRange bytes and parses CMS/PKCS#7, but no PKIjs SignedData.verify(...) call was found. A modified PDF may therefore be misclassified if the remaining structure/certificate still parses.',
    verifyFile,
    { byteRangeLine: lineOf(verifySrc, 'pdfSignedDataBytes'), finalValidityLine: lineOf(verifySrc, 'isValid = true') }
  );
} else {
  check('CMS cryptographic verification', 'PASS', 'A SignedData.verify(...) style call was found.');
}

const hashGeneration = /createHash\(['"]sha256['"]\)/i.test(pdfSrc);
const hashStored = /DocumentHash/.test(pdfSrc);
const hashUsedInVerify = /DocumentHash|calculatedDocumentHash|hashComparisonResult/.test(verifySrc);
const hashActuallyComputedInVerify = /crypto\.subtle\.digest|createHash\(|SHA-256/i.test(verifySrc);
if (hashGeneration) check('Signed-document SHA-256 generation', 'PASS', `Found in ${pdfFile}.`);
else finding('HIGH', 'Signed-document SHA-256 generation not found', 'No SHA-256 generation found in signing path.', pdfFile);
if (hashStored) check('DocumentHash persistence path', 'PASS', 'DocumentHash is persisted after completed signing.');
else finding('HIGH', 'DocumentHash persistence not found', 'Generated document hash does not appear to be stored.', pdfFile);
if (hashUsedInVerify && !hashActuallyComputedInVerify) {
  finding('HIGH', 'Verification UI exposes hash fields without performing a real hash comparison', 'The verification page references calculatedDocumentHash/hashComparisonResult, but no SHA-256 computation of the uploaded document was found in that page.', verifyFile);
} else if (hashActuallyComputedInVerify) {
  check('Uploaded-document hash calculation', 'PASS', 'A hash computation is present in VerifyDocument.');
}

if (/contents\.trim\(\)/.test(verifySrc)) {
  finding('MEDIUM', 'CMS padding handling relies on String.trim()', 'PDF signature placeholders are normally zero-padded binary/hex data. String.trim() is not a robust DER-length/padding parser.', verifyFile, { line: lineOf(verifySrc, 'contents.trim()') });
}

if (/currentDate\s*<\s*notBefore|currentDate\s*>\s*notAfter/.test(verifySrc)) {
  check('Certificate date-window check', 'PASS', 'Current date is compared to certificate notBefore/notAfter.');
}
if (/isValid\s*=\s*true/.test(verifySrc) && !hasCryptoVerify) {
  finding('CRITICAL', 'Final Valid status can be driven by certificate date alone', 'The current implementation sets isValid=true when the certificate date is in range even though CMS cryptographic verification is absent.', verifyFile, { line: lineOf(verifySrc, 'isValid = true') });
}

const trustSignals = /CertificateChainValidationEngine|trustedCerts|trustStore|CAfile|certificate chain/i.test(verifySrc);
const revocationSignals = /OCSP|CRL|revocation/i.test(verifySrc);
const tsaSignals = /timestamp|TimeStampToken|TSA|1\.2\.840\.113549\.1\.9\.16\.2\.14/i.test(verifySrc);
if (!trustSignals) finding('MEDIUM', 'Certificate trust-chain validation not found', 'The verifier appears to parse signer certificates but not establish a trusted root/intermediate chain.', verifyFile);
if (!revocationSignals) finding('MEDIUM', 'Certificate revocation validation not found', 'No OCSP/CRL revocation check was found in the document verification page.', verifyFile);
if (!tsaSignals) finding('MEDIUM', 'Trusted timestamp validation not found', 'No RFC 3161/TSA validation was found in the document verification page.', verifyFile);

if (editTemplateSrc) {
  const geometryOnly = /page\.getSize\(\)/.test(editTemplateSrc) && /Math\.round\(width\).*Math\.round\(height\)/s.test(editTemplateSrc);
  if (geometryOnly) {
    finding('HIGH', 'Template replacement metadata hash protects only page geometry', 'getPdfMetadataHash hashes page number/width/height, not the PDF content. A different document with the same page dimensions can pass this check.', editTemplateFile, { line: lineOf(editTemplateSrc, 'getPdfMetadataHash') });
  }
}

if (/keystore_681\.pfx/.test(genCertSrc) || /keystore_681\.pfx/.test(pdfSrc)) {
  finding('MEDIUM', 'Bundled fallback signing certificate is still referenced', 'A production signing path can fall back to keystore_681.pfx. Bundled certificates must be checked for expiry and should not be a silent production fallback.', genCertFile);
}

// ---------------------------
// 3) Bundled certificate inspection
// ---------------------------
const certCandidates = allFiles.filter((f) => /\.(pfx|p12|crt|cer|pem)$/i.test(f.rel));
const certInspection = [];
const openssl = run('openssl', ['version']);
if (!openssl.ok) {
  finding('MEDIUM', 'OpenSSL unavailable', 'Certificate and independent CMS checks cannot run without OpenSSL in PATH.');
} else {
  check('OpenSSL availability', 'PASS', openssl.stdout.trim());
  for (const c of certCandidates) {
    const ext = path.extname(c.abs).toLowerCase();
    let info = null;
    if (ext === '.crt' || ext === '.cer' || ext === '.pem') {
      const r = run('openssl', ['x509', '-in', c.abs, '-noout', '-subject', '-issuer', '-dates', '-serial']);
      if (r.ok) info = r.stdout.trim();
    } else {
      // Try known/default passphrases only when explicitly present in source. Never print them.
      const passCandidates = new Set(['']);
      const passLiteral = [...`${pdfSrc}\n${genCertSrc}`.matchAll(/passphrase\s*=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const p of passLiteral) passCandidates.add(p);
      for (const p of passCandidates) {
        const r = run('openssl', ['pkcs12', '-in', c.abs, '-clcerts', '-nokeys', '-passin', `pass:${p}`]);
        if (r.ok && r.stdout.includes('BEGIN CERTIFICATE')) {
          const tmp = path.join(os.tmpdir(), `audit-cert-${crypto.randomUUID()}.pem`);
          fs.writeFileSync(tmp, r.stdout);
          const x = run('openssl', ['x509', '-in', tmp, '-noout', '-subject', '-issuer', '-dates', '-serial', '-checkend', '0']);
          const xInfo = run('openssl', ['x509', '-in', tmp, '-noout', '-subject', '-issuer', '-dates', '-serial']);
          fs.rmSync(tmp, { force: true });
          info = xInfo.stdout.trim();
          certInspection.push({ file: c.rel, validNow: x.ok, info });
          if (!x.ok) finding('HIGH', 'Bundled signing certificate is expired or not yet valid', c.rel, c.rel, info);
          else check(`Certificate validity: ${c.rel}`, 'PASS', 'Certificate is currently within its validity window.');
          break;
        }
      }
    }
  }
}

// ---------------------------
// 4) Independent PDF signature verification
// ---------------------------
function parseDerTotalLength(buf) {
  if (buf.length < 2 || buf[0] !== 0x30) throw new Error('CMS does not start with ASN.1 SEQUENCE (0x30).');
  const first = buf[1];
  if ((first & 0x80) === 0) return 2 + first;
  const n = first & 0x7f;
  if (n < 1 || n > 4 || buf.length < 2 + n) throw new Error('Unsupported/invalid DER length.');
  let len = 0;
  for (let i = 0; i < n; i++) len = (len << 8) | buf[2 + i];
  return 2 + n + len;
}

function extractPdfSignatures(pdfBuf) {
  const latin = pdfBuf.toString('latin1');
  const out = [];
  const brRe = /\/ByteRange\s*\[\s*([0-9\s]+)\]/g;
  let brMatch;
  while ((brMatch = brRe.exec(latin)) !== null) {
    const nums = brMatch[1].trim().split(/\s+/).map(Number);
    if (nums.length < 4 || nums.length % 2 !== 0 || nums.some((n) => !Number.isFinite(n))) continue;
    const searchStart = brMatch.index;
    const searchEnd = Math.min(latin.length, searchStart + 4 * 1024 * 1024);
    const local = latin.slice(searchStart, searchEnd);
    const cMatch = /\/Contents\s*<([0-9A-Fa-f\s]+)>/.exec(local);
    if (!cMatch) continue;
    const hex = cMatch[1].replace(/\s+/g, '');
    if (!hex || hex.length % 2 !== 0) continue;
    let cms = Buffer.from(hex, 'hex');
    try {
      const total = parseDerTotalLength(cms);
      if (total <= cms.length) cms = cms.subarray(0, total);
    } catch {
      // keep original; OpenSSL will provide the ground-truth parse result
    }
    out.push({ byteRange: nums, cms, offset: brMatch.index });
  }
  return out;
}

function reconstructSignedBytes(pdfBuf, byteRange) {
  const parts = [];
  let total = 0;
  let previousEnd = -1;
  for (let i = 0; i < byteRange.length; i += 2) {
    const start = byteRange[i];
    const len = byteRange[i + 1];
    if (!Number.isInteger(start) || !Number.isInteger(len) || start < 0 || len <= 0 || start + len > pdfBuf.length) {
      throw new Error(`Invalid ByteRange segment [${start}, ${len}] for file size ${pdfBuf.length}`);
    }
    if (previousEnd > start) throw new Error('ByteRange segments overlap or are out of order.');
    previousEnd = start + len;
    const p = pdfBuf.subarray(start, start + len);
    parts.push(p);
    total += p.length;
  }
  return Buffer.concat(parts, total);
}

function opensslCmsVerify(cmsPath, contentPath, caFile = null) {
  const base = ['cms', '-verify', '-inform', 'DER', '-binary', '-in', cmsPath, '-content', contentPath, '-out', os.devNull];
  if (caFile) base.push('-CAfile', caFile);
  else base.push('-noverify');
  return run('openssl', base);
}

const pdfResults = [];
for (const pdfPath of options.pdf) {
  if (!fs.existsSync(pdfPath)) {
    finding('HIGH', 'Requested PDF fixture not found', pdfPath);
    continue;
  }
  const pdfBuf = fs.readFileSync(pdfPath);
  const signatures = extractPdfSignatures(pdfBuf);
  const onePdf = { file: pdfPath, sha256: sha256(pdfBuf), size: pdfBuf.length, signatures: [] };
  if (!signatures.length) {
    finding('HIGH', 'No parseable PDF signature found', `No /ByteRange + hex /Contents signature pair found in ${pdfPath}.`, pdfPath);
    pdfResults.push(onePdf);
    continue;
  }

  let sigIndex = 0;
  for (const sig of signatures) {
    sigIndex++;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-audit-'));
    const cmsPath = path.join(tempDir, 'signature.der');
    const dataPath = path.join(tempDir, 'signed-content.bin');
    fs.writeFileSync(cmsPath, sig.cms);
    let signedBytes;
    try {
      signedBytes = reconstructSignedBytes(pdfBuf, sig.byteRange);
      fs.writeFileSync(dataPath, signedBytes);
    } catch (e) {
      finding('CRITICAL', 'Invalid ByteRange in PDF fixture', e.message, pdfPath, sig.byteRange);
      fs.rmSync(tempDir, { recursive: true, force: true });
      continue;
    }

    const verify = opensslCmsVerify(cmsPath, dataPath, options.caFile);
    const sigResult = {
      index: sigIndex,
      byteRange: sig.byteRange,
      signedBytesSha256: sha256(signedBytes),
      cmsBytes: sig.cms.length,
      cryptographicSignatureValid: verify.ok,
      trustMode: options.caFile ? 'CA chain checked with provided CA file' : 'signature only; certificate chain NOT checked',
    };

    if (verify.ok) check(`PDF ${path.basename(pdfPath)} signature #${sigIndex}`, 'PASS', 'OpenSSL cryptographic CMS verification succeeded.');
    else finding('CRITICAL', 'Cryptographic PDF signature verification failed', `${path.basename(pdfPath)} signature #${sigIndex}: ${verify.stderr.trim() || verify.stdout.trim() || 'OpenSSL verification failed.'}`, pdfPath);

    // Certificate extraction/inspection
    const certsPem = path.join(tempDir, 'certs.pem');
    const certExtract = run('openssl', ['pkcs7', '-inform', 'DER', '-in', cmsPath, '-print_certs', '-out', certsPem]);
    if (certExtract.ok && fs.existsSync(certsPem)) {
      const certInfo = run('openssl', ['x509', '-in', certsPem, '-noout', '-subject', '-issuer', '-dates', '-serial', '-checkend', '0']);
      const certInfoText = run('openssl', ['x509', '-in', certsPem, '-noout', '-subject', '-issuer', '-dates', '-serial']);
      sigResult.certificate = certInfoText.stdout.trim();
      sigResult.certificateValidNow = certInfo.ok;
      if (!certInfo.ok) finding('MEDIUM', 'Signer certificate is not currently valid', `${path.basename(pdfPath)} signature #${sigIndex}`, pdfPath, sigResult.certificate);
    }

    if (!options.noTamper) {
      const tampered = Buffer.from(signedBytes);
      const pos = Math.min(Math.max(32, Math.floor(tampered.length / 2)), tampered.length - 1);
      tampered[pos] ^= 0x01;
      const tamperedPath = path.join(tempDir, 'tampered-content.bin');
      fs.writeFileSync(tamperedPath, tampered);
      const tamperVerify = opensslCmsVerify(cmsPath, tamperedPath, options.caFile);
      sigResult.tamperDetected = !tamperVerify.ok;
      if (!tamperVerify.ok) check(`Tamper test ${path.basename(pdfPath)} signature #${sigIndex}`, 'PASS', 'One-bit modification caused cryptographic verification to fail as expected.');
      else finding('CRITICAL', 'Tamper test unexpectedly passed', 'A modified signed byte still verified. Investigate immediately.', pdfPath);
    }

    onePdf.signatures.push(sigResult);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  pdfResults.push(onePdf);
}

// ---------------------------
// 5) Read-only remote smoke checks
// ---------------------------
const remoteChecks = [];
if (options.baseUrl) {
  const urls = [`${options.baseUrl}/`, `${options.baseUrl}/verify-document`];
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'SignToowix-Verification-Audit/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const body = await res.text();
      const item = {
        url,
        status: res.status,
        contentType: res.headers.get('content-type'),
        length: body.length,
        hasHtml: /<!doctype html|<html/i.test(body),
      };
      remoteChecks.push(item);
      if (res.status >= 200 && res.status < 400) check(`Remote smoke ${url}`, 'PASS', `HTTP ${res.status}; ${item.contentType || 'unknown content-type'}.`);
      else finding('HIGH', 'Remote verification route smoke check failed', `${url} returned HTTP ${res.status}.`, url);
    } catch (e) {
      finding('HIGH', 'Remote verification route unreachable', `${url}: ${e.message}`, url);
    }
  }
}

// ---------------------------
// 6) Optional project commands
// ---------------------------
const commandResults = [];
async function maybeRunProjectCommand(label, cwd, cmd, cmdArgs) {
  const r = run(cmd, cmdArgs, cwd);
  commandResults.push({ label, cwd: path.relative(repoRoot, cwd), command: [cmd, ...cmdArgs].join(' '), ok: r.ok, status: r.status, output: (r.stdout + '\n' + r.stderr).trim().slice(-12000) });
  if (r.ok) check(label, 'PASS', 'Command completed successfully.');
  else finding('HIGH', `${label} failed`, `Exit code ${r.status}. See report command output.`, path.relative(repoRoot, cwd));
}

if (options.deep) {
  const frontend = path.join(repoRoot, 'apps/OpenSign');
  const backend = path.join(repoRoot, 'apps/OpenSignServer');
  if (options.install) {
    await maybeRunProjectCommand('Frontend npm ci', frontend, 'npm', ['ci', '--no-audit', '--no-fund']);
    await maybeRunProjectCommand('Backend npm ci', backend, 'npm', ['ci', '--no-audit', '--no-fund']);
  }
  if (fs.existsSync(path.join(frontend, 'node_modules'))) {
    await maybeRunProjectCommand('Frontend tests', frontend, 'npm', ['test', '--', '--run']);
    await maybeRunProjectCommand('Frontend build', frontend, 'npm', ['run', 'build']);
  } else {
    finding('INFO', 'Frontend deep checks skipped', 'node_modules not present. Run with --deep --install or run npm ci manually.', 'apps/OpenSign');
  }
  if (fs.existsSync(path.join(backend, 'node_modules'))) {
    await maybeRunProjectCommand('Backend lint', backend, 'npm', ['run', 'lint']);
    // Avoid automatically starting mongodb-runner in unknown production environments.
    finding('INFO', 'Backend integration test command not auto-run', 'npm test starts mongodb-runner. Run it in local/staging CI where Mongo test infrastructure is safe.', 'apps/OpenSignServer');
  } else {
    finding('INFO', 'Backend deep checks skipped', 'node_modules not present. Run with --deep --install or run npm ci manually.', 'apps/OpenSignServer');
  }
}

// ---------------------------
// 7) Final report
// ---------------------------
findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
const counts = findings.reduce((acc, f) => ((acc[f.severity] = (acc[f.severity] || 0) + 1), acc), {});
const report = {
  generatedAt: now.toISOString(),
  repoRoot,
  options: { ...options, caFile: options.caFile || null },
  summary: {
    filesDiscovered: allFiles.length,
    textFilesScanned: textFiles.length,
    totalLinesScanned: totalLines,
    checksPassed: checks.filter((c) => c.status === 'PASS').length,
    findingsBySeverity: counts,
  },
  checks,
  findings,
  certificateInspection: certInspection,
  pdfResults,
  remoteChecks,
  commandResults,
  limitations: [
    'A static line-by-line scan can identify patterns and missing controls, but cannot prove that every runtime branch works.',
    'Production checks in this script are intentionally read-only and cannot prove email delivery, database writes, or destructive workflows.',
    'Certificate trust/revocation/timestamp status is reported only when explicitly checked; the script never assumes trust.',
    'For full end-to-end coverage, add dedicated staging fixtures/accounts and exercise actual login, signing, email, and tenant workflows in a separate E2E suite.',
  ],
};

await fsp.writeFile(reportJsonPath, JSON.stringify(report, null, 2));

const md = [];
md.push('# SignToowix Verification Audit Report');
md.push('');
md.push(`Generated: ${report.generatedAt}`);
md.push('');
md.push('## Summary');
md.push('');
md.push(`- Files discovered: **${report.summary.filesDiscovered}**`);
md.push(`- Text/source/config files scanned: **${report.summary.textFilesScanned}**`);
md.push(`- Lines scanned: **${report.summary.totalLinesScanned.toLocaleString()}**`);
md.push(`- Passing checks: **${report.summary.checksPassed}**`);
for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']) md.push(`- ${sev}: **${counts[sev] || 0}**`);
md.push('');
md.push('## Passing Checks');
md.push('');
for (const c of checks) md.push(`- ✅ **${c.name}** — ${c.detail}`);
md.push('');
md.push('## Findings');
md.push('');
if (!findings.length) md.push('No findings.');
for (const f of findings) {
  md.push(`### ${f.severity}: ${f.title}`);
  md.push('');
  md.push(f.detail);
  if (f.file) md.push(`\nFile/target: \`${f.file}\``);
  if (f.evidence) md.push(`\nEvidence: \`${JSON.stringify(f.evidence)}\``);
  md.push('');
}
if (pdfResults.length) {
  md.push('## PDF Fixture Results');
  md.push('');
  for (const p of pdfResults) {
    md.push(`### ${p.file}`);
    md.push(`- SHA-256: \`${p.sha256}\``);
    md.push(`- Size: ${p.size} bytes`);
    for (const s of p.signatures) {
      md.push(`- Signature #${s.index}: cryptographic=${s.cryptographicSignatureValid ? 'VALID' : 'INVALID'}, tamperDetected=${s.tamperDetected ?? 'not-run'}, certificateValidNow=${s.certificateValidNow ?? 'unknown'}, trust=${s.trustMode}`);
    }
    md.push('');
  }
}
if (remoteChecks.length) {
  md.push('## Read-only Remote Smoke Checks');
  md.push('');
  for (const r of remoteChecks) md.push(`- ${r.url}: HTTP ${r.status}, ${r.contentType || 'unknown'}`);
  md.push('');
}
if (commandResults.length) {
  md.push('## Project Command Results');
  md.push('');
  for (const r of commandResults) md.push(`- ${r.ok ? '✅' : '❌'} ${r.label}: \`${r.command}\``);
  md.push('');
}
md.push('## Important Limitations');
md.push('');
for (const l of report.limitations) md.push(`- ${l}`);
md.push('');
md.push('## Recommended Next Step');
md.push('');
md.push('Fix CRITICAL findings first, then HIGH findings. After that, create a staging-only end-to-end suite covering login → tenant routing → upload → send → email → signing → completion → verification.');

await fsp.writeFile(reportMdPath, md.join('\n'));

console.log('\n=== SignToowix Verification Audit ===');
console.log(`Scanned ${allFiles.length} files / ${totalLines.toLocaleString()} lines.`);
console.log(`Findings: CRITICAL=${counts.CRITICAL || 0}, HIGH=${counts.HIGH || 0}, MEDIUM=${counts.MEDIUM || 0}, LOW=${counts.LOW || 0}, INFO=${counts.INFO || 0}`);
console.log(`Markdown report: ${reportMdPath}`);
console.log(`JSON report:     ${reportJsonPath}`);
if ((counts.CRITICAL || 0) > 0) process.exitCode = 2;
else if ((counts.HIGH || 0) > 0) process.exitCode = 1;
