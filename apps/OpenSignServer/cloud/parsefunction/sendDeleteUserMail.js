import { appName, smtpenable } from '../../Utils.js';
import { baseTemplate, esc } from '../emailTemplates.js';

export const errHtml = err => {
  return `<html><head><meta http-equiv="Content-Type" content="text/html;charset=UTF-8" /><title>Reset Password</title></head>
  <body><h1 style="color:#1a5fa0; margin-bottom:16px;">${err}</h1></body></html>`;
};
const sendDeleteUserMail = async req => {
  const app = req.params.app || appName;
  if (!req.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  try {
    const { userId } = req.params;
    if (!userId) {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Missing userId parameter.');
    }

    const userPointer = { __type: 'Pointer', className: '_User', objectId: userId };

    const createdByPointer = { __type: 'Pointer', className: '_User', objectId: req.user.id };

    const userCondition = new Parse.Query('contracts_Users');
    userCondition.equalTo('UserId', userPointer);

    const userAndCreatorCondition = new Parse.Query('contracts_Users');
    userAndCreatorCondition.equalTo('UserId', userPointer);
    userAndCreatorCondition.equalTo('CreatedBy', createdByPointer);

    const mainQuery = Parse.Query.or(userCondition, userAndCreatorCondition);

    const result = await mainQuery.first({ useMasterKey: true });
    const username = result.get('Email')?.toLowerCase()?.replace(/\s/g, '');
    const name = result?.get('Name') || '';
    const isAdmin = result?.get('UserRole') === 'contracts_Admin';
    if (!isAdmin) {
      throw new Parse.Error(
        Parse.Error.SCRIPT_FAILED,
        'This action is not permitted. Kindly contact your administrator to request account deletion.'
      );
    }

    const serverUrl = process.env?.SERVER_URL?.replace(/\/app\/?$/, '/');
    const deleteUrl = `${serverUrl}delete-account/${userId}`;
    const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
    // Render a simple HTML form. In production, consider using a templating engine.

    await Parse.Cloud.sendEmail({
      sender: app + ' <' + mailsender + '>',
      recipient: username,
      subject: `Account Deletion Request for ${username} – ${app}`,
      text: `Account Deletion Request for ${username} – ${app}`,
      html: baseTemplate({
        heading: 'Request to delete your account',
        intro: `Hello ${esc(name) || 'there'}, we have received a request to permanently delete your <strong>${esc(app)}</strong> account associated with <strong>${esc(username)}</strong>.`,
        bodyHtml: `<div class="email-muted" style="color:#6B7280;font-size:14px;line-height:1.65;margin-top:10px;">If you did not make this request, please ignore this email. Otherwise, click below to proceed with the deletion.</div>`,
        ctaLabel: 'Confirm account deletion',
        ctaUrl: deleteUrl,
        footnote: `This action is irreversible and all your data will be permanently removed from our systems. If you have any questions or need assistance, please contact our support team.<br/><br/>&copy; ${new Date().getFullYear()} ${esc(app)}. All rights reserved.`,
      }),
    });
    return 'mail sent.';
  } catch (err) {
    console.log('Err in sending delete user email ', err);
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, err.message);
  }
};
export default sendDeleteUserMail;
