// Powers the "Users X/Y" and storage-used indicators on the Users page -
// same MaxUsers/usedStorage fields addUser.js and Utils.js already enforce
// and update, just surfaced back to the frontend for display.
//
// Only a company admin gets to see the tenant-wide total: a plain member
// sees just their own usage (summed from partners_DataFiles, which records
// one row per uploaded file with its owning UserId), never the company's.
export default async function getTenantUsage(request) {
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

  const tenantId = callerExtUser.get('TenantId')?.id;
  if (!tenantId) {
    return { maxUsers: null, currentUserCount: 0, usedStorage: 0, isOwnStorage: false };
  }

  const tenantPtr = { __type: 'Pointer', className: 'partners_Tenant', objectId: tenantId };
  const callerRole = callerExtUser.get('UserRole');
  const isAdmin = callerRole === 'contracts_Admin' || callerRole === 'contracts_OrgAdmin';

  const [tenant, currentUserCount, usedStorage] = await Promise.all([
    new Parse.Query('partners_Tenant').get(tenantId, { useMasterKey: true }),
    (() => {
      const q = new Parse.Query('contracts_Users');
      q.equalTo('TenantId', tenantPtr);
      q.notEqualTo('IsDisabled', true);
      return q.count({ useMasterKey: true });
    })(),
    isAdmin
      ? (async () => {
          const q = new Parse.Query('partners_TenantCredits');
          q.equalTo('PartnersTenant', tenantPtr);
          const credits = await q.first({ useMasterKey: true });
          return credits?.get('usedStorage') || 0;
        })()
      : (async () => {
          const ownerPtr = { __type: 'Pointer', className: '_User', objectId: request.user.id };
          let total = 0;
          let skip = 0;
          const pageSize = 1000;
          for (;;) {
            const q = new Parse.Query('partners_DataFiles');
            q.equalTo('UserId', ownerPtr);
            q.select('FileSize');
            q.limit(pageSize);
            q.skip(skip);
            const page = await q.find({ useMasterKey: true });
            for (const file of page) total += file.get('FileSize') || 0;
            if (page.length < pageSize) break;
            skip += pageSize;
          }
          return total;
        })(),
  ]);

  return {
    maxUsers: typeof tenant.get('MaxUsers') === 'number' ? tenant.get('MaxUsers') : null,
    currentUserCount,
    usedStorage,
    isOwnStorage: !isAdmin,
  };
}
