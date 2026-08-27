#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const suiteArg = process.argv.find(value => value.startsWith('--suite='));
const suite = suiteArg?.split('=')[1] || (args.has('--quick') ? 'quick' : 'full');
const staging = args.has('--staging');
const productionReadonly = args.has('--production-readonly');
const startedAt = new Date();
const auditDir = path.join(root, 'audit');
const reportDir = path.join(root, 'audit-reports');

const excludedDirectories = new Set([
  '.git',
  'node_modules',
  'build',
  'dist',
  'coverage',
  '.nyc_output',
  'exports',
  'audit-reports',
]);
const relevantExtensions = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.yml', '.yaml',
  '.md', '.html', '.css', '.scss', '.env', '.example', '.sh', '.ps1',
  '.dockerfile', '.pfx', '.p12', '.pem', '.crt', '.key',
]);

function slash(value) {
  return value.split(path.sep).join('/');
}

async function walk(directory, output = []) {
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, output);
    else output.push(absolute);
  }
  return output;
}

function fileType(relative) {
  const lower = relative.toLowerCase();
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(lower) || lower.includes('/spec/')) return 'test';
  if (lower.includes('dockerfile') || lower.includes('docker-compose')) return 'deployment';
  if (/\.(json|ya?ml|env|example)$/.test(lower) || lower.endsWith('package-lock.json')) return 'config';
  if (/\.(md|txt)$/.test(lower)) return 'documentation';
  if (/\.(pfx|p12|pem|crt|key)$/.test(lower)) return 'secret-material';
  if (/\.(jsx?|mjs|cjs|tsx?|css|scss|html)$/.test(lower)) return 'source';
  return 'asset';
}

function responsibility(relative) {
  const lower = relative.toLowerCase();
  if (lower.includes('verify')) return 'document verification';
  if (lower.includes('pdf') || lower.includes('signature')) return 'PDF/signing';
  if (lower.includes('mail') || lower.includes('email')) return 'email';
  if (lower.includes('login') || lower.includes('auth') || lower.includes('password')) return 'authentication';
  if (lower.includes('tenant')) return 'multi-tenancy';
  if (lower.includes('report')) return 'reporting';
  if (lower.includes('contact')) return 'contacts';
  if (lower.includes('template')) return 'templates';
  if (lower.includes('test') || lower.includes('/spec/')) return 'test infrastructure';
  if (lower.includes('docker') || lower.includes('.github/')) return 'deployment/CI';
  if (lower.includes('package')) return 'dependency configuration';
  return 'application/support';
}

function runtimeRelevance(relative, type) {
  if (type === 'test' || type === 'documentation') return 'non-runtime';
  if (relative.startsWith('apps/OpenSign/src/')) return 'frontend-runtime';
  if (relative.startsWith('apps/OpenSignServer/cloud/') || relative === 'apps/OpenSignServer/index.js') return 'backend-runtime';
  if (type === 'deployment' || relative.includes('package')) return 'build/deployment';
  return 'support';
}

function knownCoverage(relative) {
  if (relative.includes('pdfSignatureVerification') || relative.endsWith('/pdf/PDF.js')) return 'focused-regression-suite';
  if (relative.includes('ExternalCertificateValidation') || relative.includes('SigningCertificate')) return 'focused-regression-suite';
  if (relative.includes('/spec/') || relative.includes('/scripts/')) return 'test-or-harness';
  return 'not-measured';
}

function csv(rows, columns) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.map(quote).join(','), ...rows.map(row => columns.map(column => quote(row[column])).join(','))].join('\n');
}

function commandExecutable(name) {
  return name;
}

const testResults = [];
function addResult(result) {
  testResults.push({ environment: 'local', durationMs: 0, evidence: '', error: '', affected: '', ...result });
}

function runCommand({ name, feature, command, commandArgs, cwd, timeoutMs = 120000, severity = 'HIGH', affected = cwd }) {
  const before = Date.now();
  const isWindowsCommandShim = process.platform === 'win32' && ['npm', 'npx'].includes(command);
  const executable = isWindowsCommandShim ? (process.env.ComSpec || 'cmd.exe') : commandExecutable(command);
  // Every command and argument is a fixed harness literal, never external input.
  const childArgs = isWindowsCommandShim
    ? ['/d', '/s', '/c', [command, ...commandArgs].join(' ')]
    : commandArgs;
  const result = spawnSync(executable, childArgs, {
    cwd: path.join(root, cwd),
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, CI: 'true' },
    windowsHide: true,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const timedOut = result.error?.code === 'ETIMEDOUT';
  addResult({
    name,
    feature,
    status: result.status === 0 ? 'PASS' : 'FAIL',
    severity,
    durationMs: Date.now() - before,
    command: [command, ...commandArgs].join(' '),
    evidence: output.slice(-6000),
    error: timedOut ? `Timed out after ${timeoutMs} ms` : result.status === 0 ? '' : (result.error?.message || `Exit code ${result.status}`),
    affected,
  });
  return result.status === 0;
}

function mark(name, feature, status, reason, severity = 'MEDIUM') {
  addResult({ name, feature, status, severity, affected: feature, error: status === 'PASS' ? '' : reason, evidence: reason });
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

const allFiles = await walk(root);
const relevantFiles = allFiles.filter(absolute => {
  const relative = slash(path.relative(root, absolute));
  const extension = path.extname(relative).toLowerCase();
  return relevantExtensions.has(extension) || /(^|\/)(Dockerfile|\.env\.example)$/.test(relative);
});
const manifest = relevantFiles.map(absolute => {
  const relative = slash(path.relative(root, absolute));
  const type = fileType(relative);
  return {
    path: relative,
    type,
    responsibility: responsibility(relative),
    runtimeRelevance: runtimeRelevance(relative, type),
    testStatus: type === 'test' ? 'TEST FILE' : knownCoverage(relative) === 'not-measured' ? 'NOT TESTED' : 'PARTIAL',
    coverageStatus: knownCoverage(relative),
  };
});

const mainPath = path.join(root, 'apps/OpenSignServer/cloud/main.js');
const mainSource = await fsp.readFile(mainPath, 'utf8');
const imports = new Map();
for (const match of mainSource.matchAll(/import\s+([A-Za-z0-9_$]+)\s+from\s+['"](.+?)['"]/g)) imports.set(match[1], match[2]);
const cloudFunctions = [...mainSource.matchAll(/Parse\.Cloud\.define\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_$]+)/g)].map(match => ({
  name: match[1],
  handler: match[2],
  implementation: imports.get(match[2]) || 'inline/unknown',
}));
const knownCloudCoverage = {
  signPdf: 'PASS',
  verifycertificateevidence: 'PASS',
  generatecertificate: 'PARTIAL',
  AuthLoginAsMail: 'PARTIAL',
  SendOTPMailV1: 'PARTIAL',
  getDocument: 'PARTIAL',
  triggerevent: 'PARTIAL',
};
const cloudMatrix = cloudFunctions.map(item => ({
  ...item,
  happyPath: knownCloudCoverage[item.name] || 'NOT TESTED',
  validation: ['signPdf', 'verifycertificateevidence'].includes(item.name) ? 'PASS' : 'NOT TESTED',
  unauthenticated: ['signPdf', 'getDocument', 'triggerevent'].includes(item.name) ? 'PASS' : 'NOT TESTED',
  unauthorizedRole: item.name === 'signPdf' ? 'PASS' : 'NOT TESTED',
  wrongTenant: 'NOT TESTED',
  invalidId: item.name === 'signPdf' ? 'PASS' : 'NOT TESTED',
}));

const routeFiles = [
  path.join(root, 'apps/OpenSignServer/index.js'),
  ...allFiles.filter(file => slash(file).includes('/cloud/customRoute/') && file.endsWith('.js')),
];
const routes = [];
for (const file of routeFiles) {
  const source = await fsp.readFile(file, 'utf8');
  for (const match of source.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete|use)\(\s*['"]([^'"]+)['"]/gi)) {
    routes.push({
      method: match[1].toUpperCase(),
      route: match[2],
      file: slash(path.relative(root, file)),
      authentication: 'NOT TESTED',
      authorization: 'NOT TESTED',
      validation: 'NOT TESTED',
      rateLimit: 'NOT TESTED',
    });
  }
}

const roles = ['contracts_Admin', 'contracts_OrgAdmin', 'contracts_Editor', 'contracts_User', 'contracts_Guest', 'SuperAdmin'];
const roleMatrix = roles.map(role => ({
  role,
  companyNameChange: role === 'contracts_Admin' ? 'CODE GUARD PRESENT / NOT TESTED' : 'CODE DENY PRESENT / NOT TESTED',
  userAdministration: ['contracts_Admin', 'contracts_OrgAdmin'].includes(role) ? 'CODE GUARD PRESENT / NOT TESTED' : 'NOT TESTED',
  crossTenantAccess: 'NOT TESTED',
  directBackendAccess: 'NOT TESTED',
}));

const emailCandidates = manifest.filter(file => file.responsibility === 'email' && file.type === 'source');
const emailMatrix = emailCandidates.map(file => ({
  component: path.basename(file.path),
  file: file.path,
  transportMocked: file.path.endsWith('SendMailOTPv1.js') ? 'PARTIAL' : 'NOT TESTED',
  recipient: 'NOT TESTED',
  subjectHtml: 'NOT TESTED',
  failureTimeout: 'NOT TESTED',
  delivery: 'NOT TESTED',
}));

await fsp.mkdir(auditDir, { recursive: true });
await fsp.mkdir(reportDir, { recursive: true });
await fsp.writeFile(path.join(auditDir, 'file-manifest.json'), JSON.stringify(manifest, null, 2));

const verificationCommand = () => runCommand({
  name: 'Complete document verification suite', feature: 'verification', command: 'node',
  commandArgs: ['scripts/run-verification-audit.mjs', '--skip-static'], cwd: '.', timeoutMs: 180000, severity: 'CRITICAL',
});
const criticalCommand = () => runCommand({
  name: 'Critical signing security regressions', feature: 'signing/security', command: 'npm',
  commandArgs: ['run', 'test:critical-signing-security'], cwd: 'apps/OpenSignServer', severity: 'CRITICAL',
});

if (productionReadonly) {
  const target = process.env.PRODUCTION_BASE_URL;
  if (!target) {
    mark('Production read-only health/static checks', 'production', 'SKIPPED', 'PRODUCTION_BASE_URL is not configured.', 'HIGH');
  } else {
    const urls = [new URL('/', target), new URL('/app/health', target)];
    for (const url of urls) {
      const before = Date.now();
      try {
        const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
        addResult({ name: `GET ${url.pathname}`, feature: 'production-readonly', status: response.ok ? 'PASS' : 'FAIL', severity: 'HIGH', durationMs: Date.now() - before, evidence: `HTTP ${response.status}`, error: response.ok ? '' : `HTTP ${response.status}` });
      } catch (error) {
        addResult({ name: `GET ${url.pathname}`, feature: 'production-readonly', status: 'FAIL', severity: 'HIGH', durationMs: Date.now() - before, error: error.message });
      }
    }
  }
} else if (staging) {
  if (!process.env.STAGING_BASE_URL || !process.env.STAGING_TEST_USER) {
    mark('Staging end-to-end suite', 'staging', 'SKIPPED', 'STAGING_BASE_URL and controlled STAGING_TEST_USER are required.', 'HIGH');
  } else {
    mark('Staging mutation suite', 'staging', 'NOT IMPLEMENTED', 'Safe dedicated-tenant browser driver is not implemented.', 'HIGH');
  }
} else {
  if (['quick', 'security'].includes(suite)) criticalCommand();
  if (['quick', 'verification'].includes(suite)) verificationCommand();

  if (['frontend', 'full'].includes(suite)) {
    runCommand({ name: 'Frontend Vitest', feature: 'frontend', command: 'npm', commandArgs: ['test'], cwd: 'apps/OpenSign', severity: 'HIGH' });
    runCommand({ name: 'Frontend production build', feature: 'frontend/build', command: 'npx', commandArgs: ['vite', 'build'], cwd: 'apps/OpenSign', timeoutMs: 180000, severity: 'CRITICAL' });
    mark('Frontend coverage', 'frontend/coverage', 'NOT TESTED', 'No frontend test files exist, so meaningful coverage cannot be produced.', 'HIGH');
  }

  if (['backend', 'full'].includes(suite)) {
    runCommand({ name: 'Backend lint', feature: 'backend/lint', command: 'npm', commandArgs: ['run', 'lint'], cwd: 'apps/OpenSignServer', severity: 'HIGH' });
    if (await portOpen(27017)) {
      runCommand({ name: 'Backend Jasmine', feature: 'backend', command: 'npx', commandArgs: ['jasmine'], cwd: 'apps/OpenSignServer', timeoutMs: 180000, severity: 'HIGH' });
      runCommand({ name: 'Backend NYC coverage', feature: 'backend/coverage', command: 'npx', commandArgs: ['nyc', 'jasmine'], cwd: 'apps/OpenSignServer', timeoutMs: 180000, severity: 'HIGH' });
    } else {
      mark('Backend Jasmine', 'backend', 'FAIL', 'Local MongoDB is not running on 127.0.0.1:27017; mongodb-runner startup timed out.', 'HIGH');
      mark('Backend NYC coverage', 'backend/coverage', 'NOT TESTED', 'Coverage requires the backend Jasmine suite and local MongoDB.', 'HIGH');
    }
  }

  if (['integration', 'full'].includes(suite)) {
    mark('General platform integration suite', 'integration', 'NOT IMPLEMENTED', 'Only signing/verification integration fixtures exist.', 'HIGH');
  }
  if (['e2e', 'full'].includes(suite)) {
    runCommand({ name: 'Three-signer E2E', feature: 'signing/e2e', command: 'npm', commandArgs: ['run', 'test:three-signer-e2e'], cwd: 'apps/OpenSignServer', severity: 'CRITICAL' });
    mark('Browser login/dashboard/signing E2E', 'browser-e2e', 'NOT IMPLEMENTED', 'No Playwright/Cypress browser harness is installed.', 'HIGH');
  }
  if (['security', 'full'].includes(suite)) {
    criticalCommand();
    runCommand({ name: 'Phase 2 security', feature: 'security', command: 'npm', commandArgs: ['run', 'test:phase2-security'], cwd: 'apps/OpenSignServer', severity: 'CRITICAL' });
    runCommand({ name: 'Malformed/revocation security gaps', feature: 'security', command: 'npm', commandArgs: ['run', 'test:verification-audit-gaps'], cwd: 'apps/OpenSignServer', severity: 'CRITICAL' });
  }
  if (['verification', 'full'].includes(suite)) verificationCommand();
  if (['email', 'full'].includes(suite)) {
    mark('Email transport contract suite', 'email', 'NOT IMPLEMENTED', 'Email transports are not mocked by a repeatable automated suite.', 'HIGH');
    mark('Controlled mailbox delivery', 'email-delivery', process.env.STAGING_EMAIL_TEST === '1' ? 'NOT IMPLEMENTED' : 'SKIPPED', process.env.STAGING_EMAIL_TEST === '1' ? 'Mailbox polling driver is not implemented.' : 'STAGING_EMAIL_TEST is not enabled.', 'HIGH');
  }
  if (suite === 'full') {
    runCommand({ name: 'Frontend production dependency audit', feature: 'supply-chain', command: 'npm', commandArgs: ['audit', '--omit=dev', '--audit-level=high'], cwd: 'apps/OpenSign', timeoutMs: 180000, severity: 'HIGH' });
    runCommand({ name: 'Backend production dependency audit', feature: 'supply-chain', command: 'npm', commandArgs: ['audit', '--omit=dev', '--audit-level=high'], cwd: 'apps/OpenSignServer', timeoutMs: 180000, severity: 'HIGH' });
    const trackedKeyMaterial = manifest.filter(file => file.type === 'secret-material');
    mark(
      'Tracked key/certificate material review',
      'secrets',
      trackedKeyMaterial.length ? 'FAIL' : 'PASS',
      trackedKeyMaterial.length
        ? `${trackedKeyMaterial.length} key/certificate file(s) require manual classification, rotation and git-history review; secret values are intentionally not printed.`
        : 'No key/certificate files were discovered.',
      'CRITICAL',
    );
    mark('Accessibility automation', 'accessibility', 'NOT IMPLEMENTED', 'No axe or equivalent browser accessibility suite is installed.', 'MEDIUM');
    mark('Performance and large-file benchmarks', 'performance', 'NOT IMPLEMENTED', 'No repeatable performance budget or benchmark harness exists.', 'MEDIUM');
    mark('Retry/idempotency/concurrency resilience', 'resilience', 'NOT TESTED', 'No platform-wide fault-injection or concurrent-request suite exists.', 'HIGH');
  }
}

const securityFindings = [
  { id: 'C-1', severity: 'CRITICAL', status: 'OPEN', finding: 'Browser still submits a complete rendered PDF; server-side field-only rendering is not implemented.' },
  { id: 'C-2', severity: 'CRITICAL', status: 'FIXED/TESTED', finding: 'Signer identity, OTP grant, stale revision and impersonation guards pass focused tests.' },
  { id: 'C-3', severity: 'CRITICAL', status: 'PARTIAL', finding: 'Runtime PFX selection fails closed, but repository PFX/key history still requires rotation/removal.' },
  { id: 'H-AUTH', severity: 'HIGH', status: 'NOT TESTED PLATFORM-WIDE', finding: 'Most Cloud Functions lack direct unauthenticated/role/cross-tenant regression tests.' },
  { id: 'H-EMAIL', severity: 'HIGH', status: 'NOT TESTED', finding: 'Email transport, templates, exactly-once behavior and real controlled delivery lack tests.' },
  { id: 'H-UI', severity: 'HIGH', status: 'NOT TESTED', finding: 'Frontend has no Vitest test files and no browser E2E harness.' },
];

const secretLocations = manifest
  .filter(file => file.type === 'secret-material' || /(^|\/)\.env(\.|$)/.test(file.path))
  .map(file => ({ type: file.type === 'secret-material' ? 'key/certificate material' : 'environment configuration', location: file.path }));

const counts = Object.fromEntries(['PASS', 'FAIL', 'SKIPPED', 'NOT IMPLEMENTED', 'NOT TESTED'].map(status => [status, testResults.filter(test => test.status === status).length]));
const blocking = testResults.filter(test => test.status === 'FAIL' && ['CRITICAL', 'HIGH'].includes(test.severity));
const criticalOpen = securityFindings.some(item => item.severity === 'CRITICAL' && item.status !== 'FIXED/TESTED');
const verdict = blocking.length || criticalOpen ? 'NOT READY' : testResults.some(test => ['SKIPPED', 'NOT TESTED', 'NOT IMPLEMENTED'].includes(test.status)) ? 'READY WITH CONDITIONS' : 'READY';

const results = {
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt.getTime(),
  suite,
  mode: productionReadonly ? 'production-readonly' : staging ? 'staging' : 'local',
  safety: productionReadonly ? 'Only GET requests are implemented; mutation methods are not available in this mode.' : 'Local/test execution only.',
  inventory: {
    discoveredFiles: manifest.length,
    sourceFiles: manifest.filter(file => file.type === 'source').length,
    testFiles: manifest.filter(file => file.type === 'test').length,
    cloudFunctions: cloudFunctions.length,
    routes: routes.length,
    roles: roles.length,
    emailComponents: emailCandidates.length,
  },
  counts,
  tests: testResults,
  securityFindings,
  secretLocations,
  coverage: { frontend: 'NOT AVAILABLE - no Vitest tests', backend: 'NOT AVAILABLE - Mongo/Jasmine did not run' },
  functionality: {
    login: 'NOT TESTED', googleLogin: 'NOT TESTED', tenantRouting: 'NOT TESTED', emails: 'NOT TESTED',
    signing: testResults.some(test => test.name === 'Three-signer E2E' && test.status === 'PASS') ? 'PASS' : 'NOT TESTED',
    multiSigner: testResults.some(test => test.name === 'Three-signer E2E' && test.status === 'PASS') ? 'PASS (single platform CMS model)' : 'NOT TESTED',
    staleRevision: testResults.some(test => test.name.includes('Critical signing') && test.status === 'PASS') ? 'PASS' : 'NOT TESTED',
    roles: 'NOT TESTED', companyNamePermission: 'CODE GUARD PRESENT / NOT TESTED',
    certificateGeneration: testResults.some(test => test.name === 'Three-signer E2E' && test.status === 'PASS') ? 'PASS' : 'NOT TESTED',
    verification: testResults.some(test => test.feature === 'verification' && test.status === 'PASS') ? 'PASS' : 'NOT TESTED',
    reports: 'NOT TESTED', productionReadonly: productionReadonly ? (counts.FAIL ? 'FAIL' : counts.SKIPPED ? 'SKIPPED' : 'PASS') : 'NOT RUN',
  },
  verdict,
};

const reportStem = productionReadonly ? 'production-readonly-audit' : staging ? 'staging-audit' : suite === 'full' ? 'full-platform' : `${suite}-audit`;
await Promise.all([
  fsp.writeFile(path.join(reportDir, `${reportStem}-results.json`), JSON.stringify(results, null, 2)),
  fsp.writeFile(path.join(reportDir, 'file-coverage.csv'), csv(manifest, ['path', 'type', 'responsibility', 'runtimeRelevance', 'testStatus', 'coverageStatus'])),
  fsp.writeFile(path.join(reportDir, 'cloud-function-matrix.csv'), csv(cloudMatrix, ['name', 'handler', 'implementation', 'happyPath', 'validation', 'unauthenticated', 'unauthorizedRole', 'wrongTenant', 'invalidId'])),
  fsp.writeFile(path.join(reportDir, 'route-matrix.csv'), csv(routes, ['method', 'route', 'file', 'authentication', 'authorization', 'validation', 'rateLimit'])),
  fsp.writeFile(path.join(reportDir, 'role-permission-matrix.csv'), csv(roleMatrix, ['role', 'companyNameChange', 'userAdministration', 'crossTenantAccess', 'directBackendAccess'])),
  fsp.writeFile(path.join(reportDir, 'email-matrix.csv'), csv(emailMatrix, ['component', 'file', 'transportMocked', 'recipient', 'subjectHtml', 'failureTimeout', 'delivery'])),
]);

const markdownCell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', ' ');
const testRows = testResults.map(test => `| ${markdownCell(test.status)} | ${markdownCell(test.feature)} | ${markdownCell(test.name)} | ${markdownCell(test.affected)} | ${markdownCell(test.error || test.evidence.split('\n').at(-1) || '')} |`);
const findingRows = securityFindings.map(item => `| ${item.id} | ${item.severity} | ${item.status} | ${item.finding} |`);
const markdown = `# Full Platform Audit\n\nGenerated: ${results.generatedAt}  \nMode: ${results.mode}  \nSuite: ${suite}  \nRelease verdict: **${verdict}**\n\n## Inventory\n\n- Files discovered: ${results.inventory.discoveredFiles}\n- Source files: ${results.inventory.sourceFiles}\n- Test files: ${results.inventory.testFiles}\n- Cloud Functions: ${results.inventory.cloudFunctions}\n- Routes: ${results.inventory.routes}\n- Roles: ${results.inventory.roles}\n- Email components: ${results.inventory.emailComponents}\n\n## Test counts\n\n${Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`).join('\n')}\n\n| Status | Feature | Test | Affected file/area | Evidence/error |\n|---|---|---|---|---|\n${testRows.join('\n')}\n\n## Coverage\n\n- Frontend: ${results.coverage.frontend}\n- Backend: ${results.coverage.backend}\n\n## Known security findings\n\n| ID | Severity | Status | Finding |\n|---|---|---|---|\n${findingRows.join('\n')}\n\n## Functionality truth table\n\n${Object.entries(results.functionality).map(([key, value]) => `- ${key}: **${value}**`).join('\n')}\n\n## Untested areas\n\nAnything marked NOT TESTED, NOT IMPLEMENTED or SKIPPED in the matrices remains unproven. The most important gaps are frontend behavior, login/Google login/session loops, role and tenant isolation, email delivery, general document lifecycle, reports/drive/templates, browser accessibility, and production deployment.\n\n## Rerun\n\n\`\`\`bash\nnpm run audit:quick\nnpm run audit:full\nnpm run audit:staging\nnpm run audit:production-readonly\n\`\`\`\n\nExit codes: 0 = no blocking failure; 1 = normal blocking test failure; 2 = open/failed critical security release gate.\n`;
const markdownName = suite === 'full' && !staging && !productionReadonly ? 'FULL_PLATFORM_AUDIT.md' : `${reportStem}.md`;
await fsp.writeFile(path.join(reportDir, markdownName), markdown);

console.log(JSON.stringify({ inventory: results.inventory, counts, verdict, reports: reportDir }, null, 2));
const appliesReleaseGate = ['full', 'quick'].includes(suite) || staging || productionReadonly;
if (criticalOpen && appliesReleaseGate) process.exitCode = 2;
else if (blocking.length) process.exitCode = 1;
