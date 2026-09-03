export default async function getUserListByOrg(req) {
  const OrganizationId = req.params.organizationId;
  const orgPtr = {
    __type: 'Pointer',
    className: 'contracts_Organizations',
    objectId: OrganizationId,
  };
  if (!req?.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  } else {
    try {
      if (!OrganizationId) {
        throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Please provide organizationId.');
      }
      // Authorize the requested organization against the caller's server-side
      // tenant/organization. This prevents an authenticated user from
      // enumerating users in an arbitrary organization or tenant.
      const callerQuery = new Parse.Query('contracts_Users');
      callerQuery.equalTo('UserId', {
        __type: 'Pointer',
        className: '_User',
        objectId: req.user.id,
      });
      callerQuery.notEqualTo('IsDisabled', true);
      const callerExtUser = await callerQuery.first({ useMasterKey: true });
      if (!callerExtUser) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
      }
      const callerTenantId = callerExtUser.get('TenantId')?.id;
      const callerOrgId = callerExtUser.get('OrganizationId')?.id;
      const callerRole = callerExtUser.get('UserRole');
      const isAdmin = callerRole === 'contracts_Admin' || callerRole === 'contracts_OrgAdmin';

      const orgQuery = new Parse.Query('contracts_Organizations');
      const targetOrg = await orgQuery.get(OrganizationId, { useMasterKey: true });
      // Must belong to the caller's tenant.
      if (!callerTenantId || targetOrg.get('TenantId')?.id !== callerTenantId) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
      }
      // Non-admins may only list their own organization.
      if (!isAdmin && OrganizationId !== callerOrgId) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Unauthorized.');
      }

      const extUser = new Parse.Query('contracts_Users');
      extUser.equalTo('OrganizationId', orgPtr);
      extUser.include('TeamIds');
      extUser.descending('createdAt');
      const userRes = await extUser.find({ useMasterKey: true });
      if (userRes.length === 0) return [];
      const _userRes = JSON.parse(JSON.stringify(userRes));

      // Per-user storage and signed-document counts, attached here rather
      // than fetched per row by the client - that would be one round trip per
      // user on every render of the list.
      try {
        const userIds = _userRes.map(u => u.UserId?.objectId).filter(Boolean);

        // Storage: partners_DataFiles.UserId is not a reliable owner (signed
        // PDFs, certificates and signer uploads often don't carry the right
        // one, which under-counts badly). Same fix as getDriveStorageBreakdown:
        // join each document's real files (URL/SignedUrl/CertificateUrl) to
        // partners_DataFiles by FileUrl, and attribute the size to whoever
        // created the document instead.
        const storageByUser = {};
        if (userIds.length) {
          const sizeByUrl = new Map();
          const fileQuery = new Parse.Query('partners_DataFiles');
          fileQuery.select('FileUrl', 'FileSize');
          fileQuery.limit(10000);
          for (const f of await fileQuery.find({ useMasterKey: true })) {
            const url = f.get('FileUrl');
            if (url) sizeByUrl.set(url, f.get('FileSize') || 0);
          }

          const docQuery = new Parse.Query('contracts_Document');
          docQuery.containedIn(
            'CreatedBy',
            userIds.map(id => ({ __type: 'Pointer', className: '_User', objectId: id }))
          );
          docQuery.notEqualTo('IsArchive', true);
          docQuery.select('URL', 'SignedUrl', 'CertificateUrl', 'CreatedBy');
          docQuery.limit(10000);
          for (const doc of await docQuery.find({ useMasterKey: true })) {
            const owner = doc.get('CreatedBy')?.id;
            if (!owner) continue;
            const urls = [doc.get('URL'), doc.get('SignedUrl'), doc.get('CertificateUrl')].filter(
              Boolean
            );
            const sizeBytes = urls.reduce((sum, url) => sum + (sizeByUrl.get(url) || 0), 0);
            storageByUser[owner] = (storageByUser[owner] || 0) + sizeBytes;
          }
        }

        // Signed count: the audit trail records who signed, so it is the only
        // reliable source - a document can have many signers and the creator
        // is not necessarily one of them.
        const signedByUser = {};
        const docQuery = new Parse.Query('contracts_Document');
        docQuery.exists('AuditTrail');
        docQuery.select('AuditTrail');
        docQuery.limit(10000);
        for (const doc of await docQuery.find({ useMasterKey: true })) {
          const seen = new Set();
          for (const entry of doc.get('AuditTrail') || []) {
            if (entry?.Activity !== 'Signed') continue;
            const signer = entry?.UserPtr?.objectId;
            // One document counts once per signer even if re-signed.
            if (signer && !seen.has(signer)) {
              seen.add(signer);
              signedByUser[signer] = (signedByUser[signer] || 0) + 1;
            }
          }
        }

        for (const u of _userRes) {
          const uid = u.UserId?.objectId;
          u.StorageUsed = uid ? storageByUser[uid] || 0 : 0;
          // Audit entries point at contracts_Users, so check both ids.
          u.DocumentsSigned = (signedByUser[u.objectId] || 0) + (uid ? signedByUser[uid] || 0 : 0);
        }
      } catch (statsErr) {
        // Stats are decoration - never fail the whole user list over them.
        console.log('getuserlistbyorg stats failed:', statsErr.message);
        for (const u of _userRes) {
          u.StorageUsed = u.StorageUsed ?? 0;
          u.DocumentsSigned = u.DocumentsSigned ?? 0;
        }
      }

      return _userRes;
    } catch (err) {
      console.log('err in getuserlist', err);
      throw err;
    }
  }
}
