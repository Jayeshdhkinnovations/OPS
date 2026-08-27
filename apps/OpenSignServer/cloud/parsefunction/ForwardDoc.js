import { appName } from '../../Utils.js';
import { baseTemplate, esc } from '../emailTemplates.js';
import sendMailWithAttachment from './sendMailWithAttachment.js';

export default async function forwardDoc(request) {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'unauthorized.');
    }
    const { docId, recipients } = request.params;
    const isReceipents = recipients?.length > 0 && recipients?.length <= 10;
    if (docId && isReceipents) {
      const userPtr = { __type: 'Pointer', className: '_User', objectId: request.user.id };
      const docQuery = new Parse.Query('contracts_Document');
      docQuery
        .equalTo('objectId', docId)
        .equalTo('CreatedBy', userPtr)
        .notEqualTo('IsArchive', true)
        .notEqualTo('IsDeclined', true)
        .include('Signers')
        .include('ExtUserPtr')
        .include('Placeholders.signerPtr')
        .include('ExtUserPtr.TenantId');
      const docRes = await docQuery.first({ useMasterKey: true });
      if (!docRes) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
      }
      const _docRes = docRes?.toJSON();
      const docName = _docRes.Name;
      const extUserId = _docRes?.ExtUserPtr?.objectId;
      const TenantAppName = appName;
      const from = _docRes?.SenderName || _docRes?.ExtUserPtr?.Email;
      const replyTo = _docRes?.SenderMail || _docRes?.ExtUserPtr?.Email;
      const senderName = _docRes?.SenderName || _docRes?.ExtUserPtr?.Name;

      try {
        let mailRes;
        for (let i = 0; i < recipients.length; i++) {
          let params = {
            extUserId: extUserId,
            pdfName: docName,
            url: _docRes?.SignedUrl || '',
            recipient: recipients[i],
            subject: `${senderName} has signed the doc - ${docName}`,
            replyto: replyTo || '',
            from: from,
            html: baseTemplate({
              heading: 'Document copy',
              intro: `A copy of the document <strong>${esc(docName)}</strong> is attached to this email. Kindly download the document from the attachment.`,
              footnote: `This is an automated email from ${TenantAppName}. For any queries regarding this email, please contact the sender ${esc(replyTo)} directly.`,
            }),
          };
          mailRes = await sendMailWithAttachment(params);
          // console.log('mailRes', mailRes);
        }
        return mailRes;
      } catch (error) {
        const msg =
          error?.response?.data?.error ||
          error?.response?.data ||
          error?.message ||
          'Something went wrong.';
        throw new Parse.Error(400, msg);
      }
    } else {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'please provide parameters.');
    }
  } catch (err) {
    console.log('Err in forwardDoc', err);
    throw err;
  }
}
