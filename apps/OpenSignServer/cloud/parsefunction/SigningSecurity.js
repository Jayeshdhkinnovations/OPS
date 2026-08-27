function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function requestUserJson(request) {
  if (!request?.user) return null;
  if (typeof request.user.toJSON === 'function') return request.user.toJSON();
  return request.user;
}

export function getAuthenticatedEmail(request) {
  const user = requestUserJson(request);
  return normalizeEmail(user?.email || user?.Email || request?.user?.get?.('email'));
}

export function requireAuthenticatedUser(request) {
  if (!request?.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User authentication is required.');
  }
  const email = getAuthenticatedEmail(request);
  if (!email) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'The authenticated account does not have a verified email address.'
    );
  }
  return { user: request.user, email };
}

export function findDocumentSigner(document, signerId) {
  if (!signerId) return null;
  return (document?.Signers || []).find(signer => signer?.objectId === signerId) || null;
}

export function requireSigningActor(request, document, signerId) {
  const authenticated = requireAuthenticatedUser(request);
  const signer = signerId ? findDocumentSigner(document, signerId) : document?.ExtUserPtr;

  if (!signer) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Signer is not assigned to this document.'
    );
  }

  if (normalizeEmail(signer?.Email || signer?.email) !== authenticated.email) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'The authenticated account does not match the requested document signer.'
    );
  }

  return signer;
}

export function requireDocumentParticipant(request, document, signerId) {
  const authenticated = requireAuthenticatedUser(request);
  const ownerEmail = normalizeEmail(document?.ExtUserPtr?.Email || document?.ExtUserPtr?.email);
  const signer = signerId ? findDocumentSigner(document, signerId) : null;

  if (signer && normalizeEmail(signer?.Email || signer?.email) !== authenticated.email) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'The authenticated account does not match the requested document signer.'
    );
  }

  const isSigner = (document?.Signers || []).some(
    candidate => normalizeEmail(candidate?.Email || candidate?.email) === authenticated.email
  );
  if (ownerEmail !== authenticated.email && !isSigner) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'You do not have access to this document.'
    );
  }
  return authenticated;
}

export function validateSigningRevision(document, params = {}) {
  const currentRevision = Number(document?.SigningRevision || 0);
  const expectedRevision = Number(params.expectedRevision);
  const currentRevisionToken = String(document?.SigningRevisionToken || '');
  const expectedRevisionToken = String(params.expectedRevisionToken || '');

  if (!Number.isInteger(expectedRevision) || expectedRevision !== currentRevision) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'This document changed after it was opened. Reload the latest revision before signing.'
    );
  }
  if (currentRevisionToken !== expectedRevisionToken) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'The signing revision token is stale or invalid. Reload the document before signing.'
    );
  }
  return { currentRevision, currentRevisionToken };
}

export { normalizeEmail };
