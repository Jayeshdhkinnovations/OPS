import { requireDocumentParticipant } from './SigningSecurity.js';
export default async function getDocument(request) {
  const docId = request.params.docId;
  const include = request?.params?.include || '';
  try {
    if (docId) {
      try {
        const query = new Parse.Query('contracts_Document');
        query.equalTo('objectId', docId);
        query.include('ExtUserPtr');
        query.include('ExtUserPtr.TenantId');
        query.include('CreatedBy');
        query.include('Signers');
        query.include('AuditTrail.UserPtr');
        query.include('Placeholders');
        query.include('DeclineBy');
        query.notEqualTo('IsArchive', true);
        if (include) {
          query?.include(include);
        }
        const res = await query.first({ useMasterKey: true });
        if (res) {
          const document = JSON.parse(JSON.stringify(res));
          requireDocumentParticipant(request, document, request.params.contactId);
          if (document?.ExtUserPtr?.TenantId) delete document.ExtUserPtr.TenantId.FileAdapters;
          delete document?.ExtUserPtr?.TenantId?.PfxFile;
          return document;
        } else {
          return { error: "document deleted or you don't have access." };
        }
      } catch (err) {
        console.log('err', err?.message || err);
        return { error: "You don't have access of this document!" };
      }
    } else {
      return { error: 'Please pass required parameters!' };
    }
  } catch (err) {
    console.log('err', err);
    if (err.code == 209) {
      return { error: 'Invalid session token' };
    } else {
      return { error: "You don't have access of this document!" };
    }
  }
}
