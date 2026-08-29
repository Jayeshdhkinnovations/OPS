// Powers the "Storage" section in SignToowix Drive: a per-folder/file
// breakdown of real storage usage, not a single running total. Each
// document can have up to three stored files (original, signed, generated
// certificate) - partners_DataFiles has the real size of every one of
// those, keyed by FileUrl, so this joins on URL/SignedUrl/CertificateUrl
// rather than trusting any counter that could drift.
export default async function getDriveStorageBreakdown(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token.');
  }

  const callerQuery = new Parse.Query('contracts_Users');
  callerQuery.equalTo('UserId', {
    __type: 'Pointer',
    className: '_User',
    objectId: request.user.id,
  });
  callerQuery.notEqualTo('IsDisabled', true);
  const callerExtUser = await callerQuery.first({ useMasterKey: true });
  if (!callerExtUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
  }
  const callerRole = callerExtUser.get('UserRole');
  const isAdmin = callerRole === 'contracts_Admin' || callerRole === 'contracts_OrgAdmin';

  const sizeByUrl = new Map();
  const fileQuery = new Parse.Query('partners_DataFiles');
  fileQuery.select('FileUrl', 'FileSize');
  fileQuery.limit(10000);
  for (const f of await fileQuery.find({ useMasterKey: true })) {
    const url = f.get('FileUrl');
    if (url) sizeByUrl.set(url, f.get('FileSize') || 0);
  }

  const docQuery = new Parse.Query('contracts_Document');
  docQuery.notEqualTo('IsArchive', true);
  docQuery.select('Name', 'Type', 'Folder', 'URL', 'SignedUrl', 'CertificateUrl', 'CreatedBy');
  docQuery.limit(10000);
  // A plain member only sees the breakdown of their own files; an admin
  // sees the whole company's, same split as getTenantUsage.
  if (!isAdmin) {
    docQuery.equalTo('CreatedBy', {
      __type: 'Pointer',
      className: '_User',
      objectId: request.user.id,
    });
  }
  const docs = await docQuery.find({ useMasterKey: true });

  const rows = docs.map(doc => {
    const urls = [doc.get('URL'), doc.get('SignedUrl'), doc.get('CertificateUrl')].filter(Boolean);
    const sizeBytes = urls.reduce((sum, url) => sum + (sizeByUrl.get(url) || 0), 0);
    return {
      objectId: doc.id,
      name: doc.get('Name') || 'Untitled',
      type: doc.get('Type') === 'Folder' ? 'Folder' : 'File',
      folderId: doc.get('Folder')?.id || null,
      sizeBytes,
    };
  });

  const folderName = new Map(rows.filter(r => r.type === 'Folder').map(r => [r.objectId, r.name]));
  const totalBytes = rows.reduce((sum, r) => sum + r.sizeBytes, 0);

  // Folders start at 0 (they have no file of their own) - roll every
  // descendant's size up into its ancestor folders, memoized so a deep
  // tree is still one pass rather than one query per level.
  const childrenByFolder = new Map();
  for (const r of rows) {
    if (!childrenByFolder.has(r.folderId)) childrenByFolder.set(r.folderId, []);
    childrenByFolder.get(r.folderId).push(r);
  }
  const folderTotal = new Map();
  function computeFolderTotal(folderId) {
    if (folderTotal.has(folderId)) return folderTotal.get(folderId);
    const children = childrenByFolder.get(folderId) || [];
    const total = children.reduce(
      (sum, child) =>
        sum + (child.type === 'Folder' ? computeFolderTotal(child.objectId) : child.sizeBytes),
      0
    );
    folderTotal.set(folderId, total);
    return total;
  }
  for (const r of rows) {
    if (r.type === 'Folder') r.sizeBytes = computeFolderTotal(r.objectId);
  }

  return {
    isAdmin,
    totalBytes,
    files: rows.map(r => ({
      ...r,
      folderName: r.folderId ? folderName.get(r.folderId) || 'Unknown folder' : 'Root',
    })),
  };
}
