export default async function restoreDocument(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  const { docId } = request.params;
  if (!docId) {
    throw new Parse.Error(Parse.Error.INVALID_PARAMETER, 'docId is required');
  }
  const query = new Parse.Query('contracts_Document');
  const doc = await query.get(docId, { useMasterKey: true });
  const owner = doc.get('CreatedBy');
  if (!owner || owner.id !== request.user.id) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      "You don't have access to this document"
    );
  }
  doc.set('IsArchive', false);
  return doc.save(null, { useMasterKey: true });
}
