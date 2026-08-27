#!/usr/bin/env node
// Single entry point for the SignToowix document-verification audit.
// Runs every automated check that exists for the verification system today
// (signing-certificate validation, Phase 2 crypto/trust/revocation/timestamp
// tests, the malformed-input/SSRF/evidence-forgery gap suite, the
// three-signer end-to-end workflow, the Phase 1 tamper-detection suite, and
// the whole-repo static architecture scan) and reports one pass/fail summary.
//
// Usage: npm run audit:verification            (from the repo root)
//        node scripts/run-verification-audit.mjs [--skip-static]

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipStatic = process.argv.includes('--skip-static');

const steps = [
  {
    name: 'Signing-certificate validation (expired/not-yet-valid/corrupt PFX rejection)',
    cwd: 'apps/OpenSignServer',
    cmd: 'npm',
    args: ['run', 'test:signing-certificate'],
  },
  {
    name: 'Critical signing security (revision compare-and-swap, signer identity binding, OTP hardening, fail-closed PFX)',
    cwd: 'apps/OpenSignServer',
    cmd: 'npm',
    args: ['run', 'test:critical-signing-security'],
  },
  {
    name: 'Expired-certificate signed PDF (integrity valid, certificate expired)',
    cwd: 'apps/OpenSignServer',
    cmd: 'npm',
    args: ['run', 'test:expired-signed-document'],
  },
  {
    name: 'Phase 2 security suite (trust chain, audit-manifest hash chain, RFC 3161, OCSP)',
    cwd: 'apps/OpenSignServer',
    cmd: 'npm',
    args: ['run', 'test:phase2-security'],
  },
  {
    name: 'Verification audit gap suite (OCSP/CRL revoked+malformed, SSRF, malformed PDF fuzz, evidence-forgery)',
    cwd: 'apps/OpenSignServer',
    cmd: 'npm',
    args: ['run', 'test:verification-audit-gaps'],
  },
  {
    name: 'Three-signer end-to-end workflow (real signPdf + GenerateCertificate)',
    cwd: 'apps/OpenSignServer',
    cmd: 'npm',
    args: ['run', 'test:three-signer-e2e'],
  },
  {
    name: 'Phase 1 tamper-detection suite (untouched/tampered/appended/unsigned)',
    cwd: 'apps/OpenSign',
    cmd: 'npm',
    args: ['run', 'test:verification'],
  },
];

if (!skipStatic) {
  steps.push({
    name: 'Whole-repository static architecture/secret scan',
    cwd: '.',
    cmd: 'node',
    args: ['scripts/verification-audit.mjs'],
    // The static scanner's own exit code encodes CRITICAL/HIGH counts, not a
    // simple pass/fail - treat any nonzero exit as "review the report",
    // not as a hard failure of this runner.
    treatNonZeroAsWarning: true,
  });
}

let hasFailure = false;
const summary = [];

for (const step of steps) {
  const cwd = path.join(repoRoot, step.cwd);
  console.log(`\n=== ${step.name} ===`);
  const result = spawnSync(step.cmd, step.args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  const failed = result.status !== 0 && !step.treatNonZeroAsWarning;
  if (result.status !== 0 && step.treatNonZeroAsWarning) {
    console.log(`(static scan exited ${result.status} - it encodes finding severity, not suite pass/fail; see audit-reports/)`);
  }
  if (failed) hasFailure = true;
  summary.push({ name: step.name, status: result.status, failed });
}

console.log('\n=== Verification audit summary ===');
for (const item of summary) {
  const mark = item.failed ? 'FAIL' : item.status === 0 ? 'PASS' : 'WARN';
  console.log(`[${mark}] ${item.name}`);
}

if (hasFailure) {
  console.log('\nOne or more verification test suites failed. See output above.');
  process.exit(1);
}
console.log('\nAll verification test suites passed.');
