import { appName, smtpenable, updateMailCount } from '../../Utils.js';
import { baseTemplate, esc } from '../emailTemplates.js';
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
    const codeBlock = `<div style="margin:22px 0;padding:16px 0;text-align:center;background:#F9FAFB;border-radius:8px;font:700 28px/1 -apple-system,'Segoe UI',Arial,sans-serif;color:#1A1A1A;letter-spacing:8px;">${esc(challenge.code)}</div>`;
    await Parse.Cloud.sendEmail({
      sender: `${appName} <${mailsender}>`,
      recipient: email,
      subject: `Your ${appName} verification code`,
      text: `Your verification code is ${challenge.code}. It expires in 10 minutes.`,
      html: baseTemplate({
        heading: 'Verification code',
        intro: 'Your code for this document is:',
        bodyHtml: codeBlock,
        footnote: 'This code expires in 10 minutes and can only be used for this document.',
      }),
    });
    if (document?.ExtUserPtr?.objectId) updateMailCount(document.ExtUserPtr.objectId);
  } catch (error) {
    await otpRecord.destroy({ useMasterKey: true }).catch(() => {});
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Unable to send verification code.');
  }

  return 'Otp send';
}
