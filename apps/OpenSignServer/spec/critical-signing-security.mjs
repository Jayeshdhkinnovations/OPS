import assert from 'node:assert/strict';

class TestParseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
TestParseError.INVALID_SESSION_TOKEN = 209;
TestParseError.OPERATION_FORBIDDEN = 119;
TestParseError.INTERNAL_SERVER_ERROR = 1;
globalThis.Parse = { Error: TestParseError };

process.env.MASTER_KEY = 'isolated-test-pepper-not-a-deployment-secret';

const {
  createOtpChallenge,
  verifyOtpChallenge,
  hashSessionToken,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
} = await import('../cloud/parsefunction/OtpSecurity.js');
const { requireSigningActor, validateSigningRevision } =
  await import('../cloud/parsefunction/SigningSecurity.js');
const { resolveSigningCertificate, SigningCertificateError } =
  await import('../cloud/parsefunction/pdf/SigningCertificate.js');

const binding = {
  email: 'signer@example.com',
  docId: 'doc-1',
  contactId: 'contact-1',
};
const challenge = createOtpChallenge(binding);
assert.match(challenge.code, /^\d{6}$/);
assert.equal(
  verifyOtpChallenge({
    ...binding,
    code: challenge.code,
    salt: challenge.salt,
    storedHash: challenge.hash,
  }),
  true
);
assert.equal(
  verifyOtpChallenge({
    ...binding,
    docId: 'different-document',
    code: challenge.code,
    salt: challenge.salt,
    storedHash: challenge.hash,
  }),
  false
);
assert.equal(OTP_MAX_ATTEMPTS, 5);
assert.equal(OTP_TTL_MS, 600000);
assert.equal(hashSessionToken('session-a'), hashSessionToken('session-a'));
assert.notEqual(hashSessionToken('session-a'), hashSessionToken('session-b'));

const document = {
  ExtUserPtr: { Email: 'owner@example.com' },
  Signers: [{ objectId: 'contact-1', Email: 'signer@example.com' }],
  SigningRevision: 2,
  SigningRevisionToken: 'revision-token-2',
};
const matchingRequest = {
  user: {
    toJSON: () => ({ email: 'SIGNER@example.com' }),
    get: key => (key === 'email' ? 'SIGNER@example.com' : undefined),
  },
};
assert.equal(requireSigningActor(matchingRequest, document, 'contact-1').objectId, 'contact-1');
assert.throws(
  () =>
    requireSigningActor(
      { user: { toJSON: () => ({ email: 'attacker@example.com' }) } },
      document,
      'contact-1'
    ),
  error => error.code === TestParseError.OPERATION_FORBIDDEN
);

assert.deepEqual(
  validateSigningRevision(document, {
    expectedRevision: 2,
    expectedRevisionToken: 'revision-token-2',
  }),
  { currentRevision: 2, currentRevisionToken: 'revision-token-2' }
);
assert.throws(
  () =>
    validateSigningRevision(document, {
      expectedRevision: 1,
      expectedRevisionToken: 'revision-token-2',
    }),
  error => error.code === TestParseError.OPERATION_FORBIDDEN
);
assert.throws(
  () =>
    validateSigningRevision(document, {
      expectedRevision: 2,
      expectedRevisionToken: 'stale-token',
    }),
  error => error.code === TestParseError.OPERATION_FORBIDDEN
);

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  PFX_BASE64: process.env.PFX_BASE64,
  ALLOW_REPOSITORY_PFX_FOR_DEVELOPMENT: process.env.ALLOW_REPOSITORY_PFX_FOR_DEVELOPMENT,
};
process.env.NODE_ENV = 'production';
delete process.env.PFX_BASE64;
delete process.env.ALLOW_REPOSITORY_PFX_FOR_DEVELOPMENT;
assert.throws(
  () => resolveSigningCertificate(),
  error => error instanceof SigningCertificateError && /No signing certificate/.test(error.message)
);
process.env.NODE_ENV = 'development';
process.env.ALLOW_REPOSITORY_PFX_FOR_DEVELOPMENT = 'true';
assert.throws(
  () => resolveSigningCertificate({ tenantPfx: { base64: 'not-a-pfx', password: 'wrong' } }),
  error =>
    error instanceof SigningCertificateError && /Tenant signing certificate/.test(error.message)
);

for (const [key, value] of Object.entries(originalEnv)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log('Critical signing security regression tests: PASS');
