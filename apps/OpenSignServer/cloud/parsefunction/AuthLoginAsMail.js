import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
import { OTP_MAX_ATTEMPTS, verifyOtpChallenge } from './OtpSecurity.js';
import { normalizeEmail } from './SigningSecurity.js';
import { createSignerAuthGrant } from './SignerAuthGrant.js';

const INVALID_OTP = 'Invalid Otp';

async function signerStillMatches(docId, contactId, email) {
  const query = new Parse.Query('contracts_Document');
  query.equalTo('objectId', docId);
  query.include('Signers');
  query.notEqualTo('IsArchive', true);
  query.notEqualTo('IsDeclined', true);
  const document = await query.first({ useMasterKey: true });
  if (!document || document.get('IsCompleted')) return false;
  const signer = (document.toJSON().Signers || []).find(item => item?.objectId === contactId);
  return Boolean(signer && normalizeEmail(signer.Email) === email);
}

async function loginAsEmail(email) {
  const query = new Parse.Query(Parse.User);
  query.equalTo('email', email);
  const user = await query.first({ useMasterKey: true });
  if (!user) return null;

  // No `data` argument (not even null) - axios would otherwise serialize
  // that as the literal 4-byte body "null", which Express's strict JSON
  // parser rejects outright before this ever reaches the /loginAs route.
  // Matches the working call shape in googleLogin.js.
  const response = await axios({
    method: 'POST',
    url: `${cloudServerUrl}/loginAs`,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': serverAppId,
      'X-Parse-Master-Key': process.env.MASTER_KEY,
    },
    params: { userId: user.id },
  });
  return response.data || null;
}

export default async function AuthLoginAsMail(request) {
  const email = normalizeEmail(request.params.email);
  const code = String(request.params.otp || '').trim();
  const docId = request.params.docId;
  const contactId = request.params.contactId;
  if (!email || !/^\d{6}$/.test(code) || !docId || !contactId) return INVALID_OTP;

  try {
    const query = new Parse.Query('defaultdata_Otp');
    query.equalTo('Email', email);
    query.equalTo('DocId', docId);
    query.equalTo('ContactId', contactId);
    const record = await query.first({ useMasterKey: true });
    if (!record) return INVALID_OTP;

    const attempts = Number(record.get('Attempts') || 0);
    const maxAttempts = Number(record.get('MaxAttempts') || OTP_MAX_ATTEMPTS);
    const expiresAt = record.get('ExpiresAt');
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now() || attempts >= maxAttempts) {
      await record.destroy({ useMasterKey: true }).catch(() => {});
      return INVALID_OTP;
    }

    const valid = verifyOtpChallenge({
      storedHash: record.get('OTPHash'),
      code,
      salt: record.get('Salt'),
      email,
      docId,
      contactId,
    });
    if (!valid) {
      record.set('Attempts', attempts + 1);
      await record.save(null, { useMasterKey: true });
      return INVALID_OTP;
    }

    if (!(await signerStillMatches(docId, contactId, email))) {
      await record.destroy({ useMasterKey: true }).catch(() => {});
      return INVALID_OTP;
    }

    // Destroy before issuing the session so this challenge is strictly single-use.
    await record.destroy({ useMasterKey: true });
    const result = await loginAsEmail(email);
    if (!result) return 'user not found!';
    await createSignerAuthGrant({
      userId: result.objectId,
      sessionToken: result.sessionToken,
      email,
      docId,
      contactId,
    });
    return result;
  } catch (error) {
    console.error('OTP authentication failed:', error?.message || 'unknown error');
    return INVALID_OTP;
  }
}
