#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = path.join(root, 'audit-reports');
const resultsPath = path.join(reportDir, 'full-platform-results.json');
const outputPath = path.join(reportDir, 'FULL_PLATFORM_AUDIT_PRINT.html');
const pdfPath = path.join(reportDir, 'FULL_PLATFORM_AUDIT_REPORT.pdf');
const report = JSON.parse(await fs.readFile(resultsPath, 'utf8'));

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const statusClass = status => String(status).toLowerCase().replaceAll(' ', '-').replaceAll('/', '-');

const reasons = {
  'Frontend Vitest': 'Failed because Vitest found no frontend test files. This is a missing-test-suite failure, not proof that the frontend itself is broken.',
  'Frontend production build': 'Passed: Vite compiled the production frontend successfully. Non-blocking bundle-size warnings remain.',
  'Frontend coverage': 'Not available because coverage cannot be measured without runnable frontend tests.',
  'Backend lint': 'Failed because ESLint 9 cannot find eslint.config.js. Static code-quality enforcement is currently unavailable.',
  'Backend Jasmine': 'Could not run because the required local MongoDB service was not available at 127.0.0.1:27017.',
  'Backend NYC coverage': 'Not available because the MongoDB-dependent Jasmine suite did not run.',
  'General platform integration suite': 'Not implemented. Existing integration fixtures concentrate on signing and verification rather than the complete platform.',
  'Three-signer E2E': 'Passed in the isolated fixture: three ordered signers completed, signer identity mismatches were rejected, and the signed output and certificate were generated.',
  'Browser login/dashboard/signing E2E': 'Not implemented because no Playwright or Cypress browser harness is installed.',
  'Critical signing security regressions': 'Passed: signer binding, OTP authorization, impersonation rejection and stale-revision protections behaved as expected.',
  'Phase 2 security': 'Passed the implemented trust, evidence, permission and verification security checks.',
  'Malformed/revocation security gaps': 'Passed the implemented malformed-PDF and external-certificate validation regressions.',
  'Complete document verification suite': 'Passed cryptographic verification, tamper detection, expired-certificate separation and related verification fixtures.',
  'Email transport contract suite': 'Not implemented. SMTP/provider calls, templates, retry behavior and exactly-once behavior are not covered by a repeatable mock suite.',
  'Controlled mailbox delivery': 'Skipped because STAGING_EMAIL_TEST and a controlled mailbox were not configured.',
  'Frontend production dependency audit': 'Passed the high/critical release threshold. npm still reports 6 production findings: 2 low and 4 moderate.',
  'Backend production dependency audit': 'Passed the high/critical release threshold. npm still reports 7 production findings: 1 low and 6 moderate.',
  'Tracked key/certificate material review': 'Failed: five key/certificate files are tracked in Git. They require classification, rotation where private material is real, and git-history review.',
  'Accessibility automation': 'Not implemented because no axe or equivalent browser accessibility suite exists.',
  'Performance and large-file benchmarks': 'Not implemented because no repeatable performance budget or benchmark harness exists.',
  'Retry/idempotency/concurrency resilience': 'Not tested because no platform-wide fault-injection or concurrent-request suite exists.',
};

const questions = [
  ['1', 'How many files were discovered?', `${report.inventory.discoveredFiles} relevant source, configuration, test and support files.`],
  ['2', 'How many source files were inspected?', `${report.inventory.sourceFiles} source files were inventoried and classified. This is not a claim that every line received manual review.`],
  ['3', 'How many routes?', `${report.inventory.routes} Express/custom routes were discovered.`],
  ['4', 'How many Cloud Functions?', `${report.inventory.cloudFunctions} Parse Cloud Functions were discovered from the current registration file.`],
  ['5', 'How many test cases were created?', `${report.tests.length} repeatable audit checks are orchestrated by the new harness; ${report.inventory.testFiles} test files were discovered. No unsupported product test was counted as implemented.`],
  ['6', 'How many passed?', `${report.counts.PASS} checks passed.`],
  ['7', 'How many failed?', `${report.counts.FAIL} checks failed.`],
  ['8', 'How many were skipped?', `${report.counts.SKIPPED} skipped, ${report.counts['NOT IMPLEMENTED']} not implemented, and ${report.counts['NOT TESTED']} not tested.`],
  ['9', 'What is frontend coverage?', report.coverage.frontend],
  ['10', 'What is backend coverage?', report.coverage.backend],
  ['11', 'What are the critical findings?', 'C-1 is open: the browser still submits a complete PDF. C-2 is fixed/tested: identity, OTP and revision guards pass. C-3 is partial: runtime PFX selection fails closed, but tracked key material remains.'],
  ['12', 'What are the high findings?', 'Platform-wide Cloud Function authorization/tenant tests, email tests and frontend/browser tests are missing.'],
  ['13', 'Which functionality is untested and why?', 'Login, Google login, tenant routing, broad role isolation, emails, reports, general document lifecycle, accessibility, performance and concurrency. The required browser, database, mailbox or fault-injection infrastructure is absent or unconfigured.'],
  ['14', 'Does login work?', 'NOT TESTED. No browser or live integration evidence proves it in this environment.'],
  ['15', 'Does Google login work?', 'NOT TESTED. No controlled OAuth environment was configured.'],
  ['16', 'Does tenant routing work?', 'NOT TESTED end to end.'],
  ['17', 'Do emails actually work?', 'NOT TESTED. A controlled mailbox and STAGING_EMAIL_TEST were not configured.'],
  ['18', 'Does signing work?', 'PASS in the isolated three-signer workflow fixture. A deployed browser-to-server signing run was not performed.'],
  ['19', 'Does multi-signer work?', 'PASS for the isolated ordered three-signer fixture.'],
  ['20', 'Does stale-revision protection work?', 'PASS in the focused critical signing security regressions.'],
  ['21', 'Are roles protected?', 'NOT TESTED platform-wide. Code guards alone are not runtime proof.'],
  ['22', 'Is company-name permission correct?', 'A role guard is present in code, but runtime permission behavior is NOT TESTED.'],
  ['23', 'Does certificate generation work?', 'PASS in the isolated three-signer fixture.'],
  ['24', 'Does verification work?', 'PASS across the implemented cryptographic, tamper, expired-certificate and malformed-input fixtures.'],
  ['25', 'Do reports work?', 'NOT TESTED.'],
  ['26', 'Did production read-only checks pass?', 'SKIPPED because PRODUCTION_BASE_URL was not configured. The harness issued no production mutation.'],
  ['27', 'How can everything be rerun?', 'Use the commands in the Reproduction Commands section of this report.'],
  ['28', 'What is the release verdict?', report.verdict],
];

const tests = report.tests.map((test, index) => `
  <tr>
    <td class="num">${index + 1}</td>
    <td><span class="status ${statusClass(test.status)}">${escapeHtml(test.status)}</span></td>
    <td>${escapeHtml(test.severity)}</td>
    <td><strong>${escapeHtml(test.name)}</strong><div class="muted">${escapeHtml(test.feature)}</div></td>
    <td>${escapeHtml(test.affected || '—')}</td>
    <td>${escapeHtml(reasons[test.name] || test.error || test.evidence || 'No additional evidence recorded.')}</td>
  </tr>`).join('');

const questionRows = questions.map(([number, question, answer]) => `
  <tr><td class="num">${number}</td><td><strong>${escapeHtml(question)}</strong></td><td>${escapeHtml(answer)}</td></tr>`).join('');

const findingRows = report.securityFindings.map(item => `
  <tr>
    <td>${escapeHtml(item.id)}</td>
    <td>${escapeHtml(item.severity)}</td>
    <td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
    <td>${escapeHtml(item.finding)}</td>
  </tr>`).join('');

const secretRows = report.secretLocations.map(item => `<li><code>${escapeHtml(item.location)}</code> — ${escapeHtml(item.type)}</li>`).join('');
const functionalityRows = Object.entries(report.functionality).map(([feature, status]) => `
  <tr><td>${escapeHtml(feature)}</td><td>${escapeHtml(status)}</td></tr>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SignToowix Full Platform Audit</title>
<style>
  @page { size: A4; margin: 15mm 14mm 17mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #172033; font-family: Inter, "Segoe UI", Arial, sans-serif; font-size: 9.2pt; line-height: 1.45; }
  h1 { color: #0b234a; font-size: 25pt; line-height: 1.08; margin: 0 0 8pt; letter-spacing: -.4pt; }
  h2 { color: #0b234a; font-size: 15pt; margin: 22pt 0 8pt; border-bottom: 1.4pt solid #0b234a; padding-bottom: 4pt; break-after: avoid; }
  h3 { color: #183a6c; font-size: 11.5pt; margin: 14pt 0 5pt; break-after: avoid; }
  p { margin: 0 0 7pt; }
  .cover { min-height: 248mm; display: flex; flex-direction: column; justify-content: space-between; break-after: page; }
  .brand { color: #183a6c; font-size: 10pt; font-weight: 700; letter-spacing: 1.2pt; text-transform: uppercase; margin-bottom: 32mm; }
  .subtitle { font-size: 12pt; color: #4b5870; max-width: 150mm; }
  .verdict { display: inline-block; margin-top: 20pt; border: 2px solid #b42318; color: #b42318; font-weight: 800; padding: 8pt 13pt; border-radius: 5pt; font-size: 15pt; }
  .cover-meta { border-top: 1px solid #aeb8c8; padding-top: 10pt; color: #59667b; }
  .notice { background: #f5f7fb; border-left: 4px solid #183a6c; padding: 9pt 11pt; margin: 10pt 0; }
  .warning { background: #fff4e5; border-left-color: #b54708; }
  .danger { background: #fff1f0; border-left-color: #b42318; }
  .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7pt; margin: 10pt 0 12pt; }
  .metric { border: 1px solid #cad2df; padding: 8pt; border-radius: 4pt; background: #fafbfc; }
  .metric .value { font-weight: 800; color: #0b234a; font-size: 17pt; line-height: 1; }
  .metric .label { margin-top: 4pt; color: #59667b; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .4pt; }
  table { border-collapse: collapse; width: 100%; margin: 7pt 0 12pt; font-size: 7.7pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { background: #0b234a; color: white; text-align: left; padding: 5.5pt 5pt; font-weight: 700; }
  td { border: 1px solid #d9dee7; vertical-align: top; padding: 5pt; }
  tbody tr:nth-child(even) { background: #f8f9fb; }
  .num { width: 25pt; text-align: center; font-weight: 700; }
  .status { display: inline-block; border: 1px solid currentColor; border-radius: 10pt; padding: 1pt 5pt; white-space: nowrap; font-size: 6.7pt; font-weight: 800; }
  .pass, .fixed-tested { color: #067647; background: #ecfdf3; }
  .fail, .open { color: #b42318; background: #fff1f0; }
  .skipped, .not-tested, .not-implemented, .partial, .not-tested-platform-wide { color: #8a4b08; background: #fff7e8; }
  .muted { color: #69758a; font-size: 6.8pt; margin-top: 1pt; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 8pt; color: #0b234a; overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; background: #101b30; color: #f6f8fc; padding: 10pt; border-radius: 4pt; font-size: 8pt; line-height: 1.5; break-inside: avoid; }
  ul { margin: 5pt 0 9pt 17pt; padding: 0; }
  li { margin: 2.5pt 0; }
  .footer-note { color: #69758a; font-size: 7.5pt; margin-top: 16pt; }
</style>
</head>
<body>
<section class="cover">
  <div>
    <div class="brand">SignToowix · QA / Security Evidence</div>
    <h1>Full Platform<br>Audit Report</h1>
    <p class="subtitle">A factual report of what was discovered, what was executed, what passed, what failed, why it failed, and what remains unproven.</p>
    <div class="verdict">RELEASE VERDICT: ${escapeHtml(report.verdict)}</div>
  </div>
  <div class="cover-meta">
    <p><strong>Evidence generated:</strong> ${escapeHtml(report.generatedAt)}</p>
    <p><strong>Environment:</strong> ${escapeHtml(report.mode)} · <strong>Suite:</strong> ${escapeHtml(report.suite)}</p>
    <p><strong>Safety:</strong> ${escapeHtml(report.safety)}</p>
    <p>This report does not claim that an untested feature works. “Pass” is used only where an executed check or runtime fixture produced supporting evidence.</p>
  </div>
</section>

<h2>Executive result</h2>
<div class="metrics">
  <div class="metric"><div class="value">${report.inventory.discoveredFiles}</div><div class="label">Files discovered</div></div>
  <div class="metric"><div class="value">${report.inventory.cloudFunctions}</div><div class="label">Cloud Functions</div></div>
  <div class="metric"><div class="value">${report.counts.PASS}</div><div class="label">Passed</div></div>
  <div class="metric"><div class="value">${report.counts.FAIL}</div><div class="label">Failed</div></div>
</div>
<div class="notice danger"><strong>Not all tests passed.</strong> The frontend build and implemented signing/verification security fixtures passed, but four release-blocking audit checks failed and substantial platform areas remain untested.</div>
<p>The four failures are: no frontend test files; missing ESLint 9 configuration; unavailable local MongoDB for backend Jasmine/coverage; and five tracked key/certificate files requiring security review.</p>

<h2>All 28 requested questions answered</h2>
<table>
  <thead><tr><th>#</th><th>Question</th><th>Evidence-based answer</th></tr></thead>
  <tbody>${questionRows}</tbody>
</table>

<h2>Complete executed-check ledger</h2>
<p>Counts: ${report.counts.PASS} passed, ${report.counts.FAIL} failed, ${report.counts.SKIPPED} skipped, ${report.counts['NOT IMPLEMENTED']} not implemented and ${report.counts['NOT TESTED']} not tested.</p>
<table>
  <thead><tr><th>#</th><th>Status</th><th>Severity</th><th>Check</th><th>Affected area</th><th>What happened and why</th></tr></thead>
  <tbody>${tests}</tbody>
</table>

<h2>Security findings</h2>
<table>
  <thead><tr><th>ID</th><th>Severity</th><th>Status</th><th>Finding</th></tr></thead>
  <tbody>${findingRows}</tbody>
</table>

<h3>Critical findings in plain language</h3>
<div class="notice danger"><strong>C-1 — untrusted whole-PDF input remains open.</strong> The browser can return an entire edited PDF for signing. Example: a compromised browser could alter contract text along with the permitted signature field. The safer design is for the browser to submit only field values while the server applies them to its trusted PDF copy.</div>
<div class="notice"><strong>C-2 — signer and revision controls pass.</strong> The focused tests confirm that one signer cannot impersonate another, OTP authorization is signer-bound, and stale document revisions are rejected.</div>
<div class="notice warning"><strong>C-3 — key handling is only partial.</strong> Runtime fallback now fails closed, but tracked private-key/certificate material may remain retrievable from Git history. Real keys must be rotated and moved to managed secrets/KMS storage.</div>

<h3>Tracked key and certificate locations</h3>
<ul>${secretRows}</ul>
<p>No key contents or passwords are printed in this report.</p>

<h2>Functionality truth table</h2>
<table><thead><tr><th>Functionality</th><th>Result</th></tr></thead><tbody>${functionalityRows}</tbody></table>
<div class="notice warning"><strong>Important limitation:</strong> the signing, multi-signer and certificate results come from isolated repeatable fixtures. Login, dashboard, tenant and email flows were not driven through a deployed browser application.</div>

<h2>Coverage and test-infrastructure gaps</h2>
<p><strong>Frontend:</strong> ${escapeHtml(report.coverage.frontend)}. Vitest exits with “No test files found.”</p>
<p><strong>Backend:</strong> ${escapeHtml(report.coverage.backend)}. Jasmine expects MongoDB at <code>127.0.0.1:27017</code>.</p>
<ul>
  <li>ESLint 9 needs a valid <code>eslint.config.js</code>.</li>
  <li>A local/test MongoDB instance is required before Jasmine and NYC coverage can run.</li>
  <li>Browser E2E is needed for login, registration, dashboard, signing UI, Google login and error-state behavior.</li>
  <li>Controlled staging accounts and mailbox credentials are required for safe live workflow and delivery checks.</li>
  <li>Role/tenant matrices identify missing tests; they do not certify authorization behavior.</li>
</ul>

<h2>Dependency audit</h2>
<p>Both <code>npm audit --omit=dev --audit-level=high</code> checks passed the high/critical threshold. This does not mean zero dependency findings:</p>
<ul>
  <li>Frontend: 6 production findings — 2 low and 4 moderate.</li>
  <li>Backend: 7 production findings — 1 low and 6 moderate.</li>
  <li>Some proposed updates are breaking changes and require controlled regression testing.</li>
</ul>

<h2>Staging and production safety</h2>
<p><strong>Staging:</strong> skipped because <code>STAGING_BASE_URL</code> and a controlled <code>STAGING_TEST_USER</code> were not configured.</p>
<p><strong>Production read-only:</strong> skipped because <code>PRODUCTION_BASE_URL</code> was not configured. The implementation permits only GET checks for the public root and health endpoint; it contains no create, update, delete, sign or email operation.</p>

<h2>Reproduction commands</h2>
<pre>npm run audit:quick
npm run audit:full
npm run test:frontend
npm run test:backend
npm run test:integration
npm run test:e2e
npm run test:security
npm run test:email
npm run test:verification
npm run audit:staging
npm run audit:production-readonly</pre>
<p>Direct runner exit codes: 0 = no blocking failure; 1 = ordinary blocking failure; 2 = open or failed critical-security release gate.</p>

<h2>Generated evidence files</h2>
<ul>
  <li><code>audit/file-manifest.json</code></li>
  <li><code>audit-reports/full-platform-results.json</code></li>
  <li><code>audit-reports/file-coverage.csv</code></li>
  <li><code>audit-reports/cloud-function-matrix.csv</code></li>
  <li><code>audit-reports/route-matrix.csv</code></li>
  <li><code>audit-reports/role-permission-matrix.csv</code></li>
  <li><code>audit-reports/email-matrix.csv</code></li>
</ul>

<h2>Final release decision</h2>
<div class="notice danger"><strong>${escapeHtml(report.verdict)}</strong> — do not interpret the passing signing and verification fixtures as proof that the entire platform works. Resolve the critical PDF source-of-truth/key-management findings and add the missing browser, database, authorization, tenant and email tests before changing the verdict.</div>
<p class="footer-note">Generated automatically from audit-reports/full-platform-results.json. This is a QA/security evidence report, not a legal certification.</p>
</body>
</html>`;

await fs.writeFile(outputPath, html, 'utf8');

const browserCandidates = process.platform === 'win32'
  ? [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

let browser;
for (const candidate of browserCandidates) {
  try {
    await fs.access(candidate);
    browser = candidate;
    break;
  } catch {
    // Continue to the next known local browser path.
  }
}

if (!browser) {
  throw new Error(`Printable HTML was created at ${outputPath}, but no supported Chromium browser was found to generate the PDF.`);
}

const printStartedAt = Date.now();
const print = spawnSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-pdf-header-footer',
  `--print-to-pdf=${pdfPath}`,
  pathToFileURL(outputPath).href,
], { encoding: 'utf8', windowsHide: true });

if (print.error) throw print.error;

let generated = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    const stat = await fs.stat(pdfPath);
    if (stat.size > 0 && stat.mtimeMs >= printStartedAt - 1000) {
      generated = true;
      break;
    }
  } catch {
    // Chromium can return just before the PDF is visible on disk.
  }
  await new Promise(resolve => setTimeout(resolve, 100));
}

if (!generated) {
  throw new Error(`Chromium did not create a current PDF. ${print.stderr || print.stdout || ''}`.trim());
}

console.log(JSON.stringify({ html: outputPath, pdf: pdfPath }, null, 2));
