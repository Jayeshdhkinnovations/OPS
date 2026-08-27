import { requireDocumentParticipant } from './SigningSecurity.js';

export default async function triggerEvent(request) {
  const event = request.params.event;
  const body = request.params.body;
  const docId = body.objectId;
  const contactId = request.params.contactId;
  try {
    const docQuery = new Parse.Query('contracts_Document');
    docQuery.include('ExtUserPtr,Signers');
    const docRes = await docQuery.get(docId, { useMasterKey: true });
    const _docRes = docRes && docRes?.toJSON();
    const ipAddress = request.headers['x-real-ip'] || '';
    requireDocumentParticipant(request, _docRes, contactId);

    if (event === 'viewed' && contactId) {
      const auditTrail = Array.isArray(_docRes.AuditTrail) ? _docRes.AuditTrail : [];
      const contactPtr = {
        __type: 'Pointer',
        className: 'contracts_Contactbook',
        objectId: contactId,
      };
      const date = new Date().toISOString();
      const newEntry = {
        UserPtr: contactPtr,
        SignedUrl: _docRes?.SignedUrl || '',
        Activity: 'Viewed',
        ipAddress,
        ViewedOn: date,
      };

      const existingIndex = auditTrail.findIndex(x => x?.UserPtr?.objectId === contactId);

      let updatedAuditTrail;

      if (existingIndex !== -1) {
        // update existing entry
        updatedAuditTrail = [...auditTrail];
        updatedAuditTrail[existingIndex] = {
          ...updatedAuditTrail[existingIndex],
          SignedUrl: _docRes?.SignedUrl || updatedAuditTrail[existingIndex]?.SignedUrl || '',
          Activity: 'Viewed',
          ipAddress,
          ViewedOn: date,
        };
      } else {
        // add new entry
        updatedAuditTrail = [...auditTrail, newEntry];
      }

      // save only once
      const updateDoc = new Parse.Object('contracts_Document');
      updateDoc.id = docRes.id;
      updateDoc.set('AuditTrail', updatedAuditTrail);
      await updateDoc.save(null, { useMasterKey: true });
    }

    return { message: 'event called!' };
  } catch (err) {
    console.log(
      `triggerEvent error: `,
      err?.response?.data?.error || err?.message || 'Something went wrong!'
    );
    return { message: 'Something went wrong!' };
  }
}
