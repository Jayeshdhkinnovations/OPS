import { hashSessionToken } from './OtpSecurity.js';

const AUTH_GRANT_TTL_MS = 30 * 60 * 1000;

export async function createSignerAuthGrant({ userId, sessionToken, email, docId, contactId }) {
  if (!userId || !sessionToken || !docId || !contactId) {
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Unable to bind signer session.');
  }

  const oldQuery = new Parse.Query('defaultdata_SignerAuthGrant');
  oldQuery.equalTo('UserId', userId);
  oldQuery.equalTo('DocId', docId);
  oldQuery.equalTo('ContactId', contactId);
  const oldGrants = await oldQuery.find({ useMasterKey: true });
  if (oldGrants.length) await Parse.Object.destroyAll(oldGrants, { useMasterKey: true });

  const grant = new Parse.Object('defaultdata_SignerAuthGrant');
  grant.set('UserId', userId);
  grant.set('Email', email);
  grant.set('DocId', docId);
  grant.set('ContactId', contactId);
  grant.set('SessionHash', hashSessionToken(sessionToken));
  grant.set('ExpiresAt', new Date(Date.now() + AUTH_GRANT_TTL_MS));
  await grant.save(null, { useMasterKey: true });
}

export async function consumeSignerAuthGrant(request, docId, contactId) {
  const userJson = request?.user?.toJSON?.() || request?.user || {};
  const userId = request?.user?.id || userJson?.objectId;
  const sessionToken =
    request?.user?.getSessionToken?.() ||
    request?.headers?.['x-parse-session-token'] ||
    request?.headers?.['X-Parse-Session-Token'];
  if (!userId || !sessionToken) {
    throw new Parse.Error(
      Parse.Error.INVALID_SESSION_TOKEN,
      'This signing action requires a document-bound OTP session.'
    );
  }

  const query = new Parse.Query('defaultdata_SignerAuthGrant');
  query.equalTo('UserId', userId);
  query.equalTo('DocId', docId);
  query.equalTo('ContactId', contactId);
  query.equalTo('SessionHash', hashSessionToken(sessionToken));
  const grant = await query.first({ useMasterKey: true });
  const expiresAt = grant?.get('ExpiresAt');
  if (!grant || !expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
    if (grant) await grant.destroy({ useMasterKey: true }).catch(() => {});
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'The document OTP session is missing or expired. Verify your email again.'
    );
  }

  await grant.destroy({ useMasterKey: true });
  return true;
}
