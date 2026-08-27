import { appName, smtpenable, updateMailCount } from '../../Utils.js';
import { createOtpChallenge, OTP_MAX_ATTEMPTS } from './OtpSecurity.js';
import { normalizeEmail } from './SigningSecurity.js';

const OTP_RESEND_DELAY_MS = 30 * 1000;

async function getBoundDocument(docId, contactId, email) {
  if (!docId || !contactId) {
    throw new Parse.Error(
      Parse.Error.INVALID_QUERY,
      'Document and signer identifiers are required for OTP authentication.'
    );
  }

  const query = new Parse.Query('contracts_Document');
  query.equalTo('objectId', docId);
  query.include('ExtUserPtr,ExtUserPtr.TenantId,Signers');
  query.notEqualTo('IsArchive', true);
  query.notEqualTo('IsDeclined', true);
  const document = await query.first({ useMasterKey: true });
  if (!document || document.get('IsCompleted')) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document is not available for signing.');
  }

  const json = document.toJSON();
  const signer = (json.Signers || []).find(candidate => candidate?.objectId === contactId);
  if (!signer || normalizeEmail(signer.Email) !== normalizeEmail(email)) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'The email address does not match the requested document signer.'
    );
  }
  return { document: json, signer };
}

export default async function sendMailOTPv1(request) {
  const email = normalizeEmail(request.params.email);
  const docId = request.params.docId;
  const contactId = request.params.contactId;
  if (!email) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Please enter a valid email address.');
  }

  const { document } = await getBoundDocument(docId, contactId, email);
  const existingQuery = new Parse.Query('defaultdata_Otp');
  existingQuery.equalTo('Email', email);
  existingQuery.equalTo('DocId', docId);
  existingQuery.equalTo('ContactId', contactId);
  let otpRecord = await existingQuery.first({ useMasterKey: true });

  if (
    otpRecord?.updatedAt &&
    Date.now() - new Date(otpRecord.updatedAt).getTime() < OTP_RESEND_DELAY_MS
  ) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Please wait before requesting another verification code.'
    );
  }

  const challenge = createOtpChallenge({ email, docId, contactId });
  if (!otpRecord) otpRecord = new Parse.Object('defaultdata_Otp');
  otpRecord.set('Email', email);
  otpRecord.set('DocId', docId);
  otpRecord.set('ContactId', contactId);
  otpRecord.set('TenantId', document?.ExtUserPtr?.TenantId?.objectId || '');
  otpRecord.set('OTPHash', challenge.hash);
  otpRecord.set('Salt', challenge.salt);
  otpRecord.set('ExpiresAt', challenge.expiresAt);
  otpRecord.set('Attempts', 0);
  otpRecord.set('MaxAttempts', OTP_MAX_ATTEMPTS);
  otpRecord.unset('OTP');
  await otpRecord.save(null, { useMasterKey: true });

  const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
  try {
    await Parse.Cloud.sendEmail({
      sender: `${appName} <${mailsender}>`,
      recipient: email,
      subject: `Your ${appName} verification code`,
      text: `Your verification code is ${challenge.code}. It expires in 10 minutes.`,
      html: `<html><head><meta http-equiv='Content-Type' content='text/html;charset=UTF-8' /></head><body><div style='background-color:#f5f5f5;padding:20px'><div style='background-color:white;'><div style='padding:2px;font-family:system-ui;background-color:#47a3ad;'><p style='font-size:20px;font-weight:400;color:white;padding-left:20px;'>Verification code</p></div><div style='padding:20px;'><p style='font-family:system-ui;font-size:14px;'>Your code for this document is:</p><p style='font-weight:bolder;color:blue;font-size:45px;margin:20px;'>${challenge.code}</p><p style='font-family:system-ui;font-size:12px;'>This code expires in 10 minutes and can only be used for this document.</p></div></div></div></body></html>`,
    });
    if (document?.ExtUserPtr?.objectId) updateMailCount(document.ExtUserPtr.objectId);
  } catch (error) {
    await otpRecord.destroy({ useMasterKey: true }).catch(() => {});
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Unable to send verification code.');
  }

  return 'Otp send';
}
