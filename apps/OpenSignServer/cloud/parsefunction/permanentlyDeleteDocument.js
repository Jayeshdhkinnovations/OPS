export default async function permanentlyDeleteDocument(request) {
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
  if (doc.get('IsArchive') !== true) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Only trashed items can be permanently deleted'
    );
  }
  await doc.destroy({ useMasterKey: true });
  return { success: true };
}
