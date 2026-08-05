// Powers the "Users X/Y" and storage-used indicators on the Users page -
// same MaxUsers/usedStorage fields addUser.js and Utils.js already enforce
// and update, just surfaced back to the frontend for display.
export default async function getTenantUsage(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token.');
  }

  const callerQuery = new Parse.Query('contracts_Users');
  callerQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: request.user.id });
  callerQuery.notEqualTo('IsDisabled', true);
  const callerExtUser = await callerQuery.first({ useMasterKey: true });
  if (!callerExtUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
  }

  const tenantId = callerExtUser.get('TenantId')?.id;
  if (!tenantId) {
    return { maxUsers: null, currentUserCount: 0, usedStorage: 0 };
  }

  const tenantPtr = { __type: 'Pointer', className: 'partners_Tenant', objectId: tenantId };

  const [tenant, currentUserCount, credits] = await Promise.all([
    new Parse.Query('partners_Tenant').get(tenantId, { useMasterKey: true }),
    (() => {
      const q = new Parse.Query('contracts_Users');
      q.equalTo('TenantId', tenantPtr);
      q.notEqualTo('IsDisabled', true);
      return q.count({ useMasterKey: true });
    })(),
    (() => {
      const q = new Parse.Query('partners_TenantCredits');
      q.equalTo('PartnersTenant', tenantPtr);
      return q.first({ useMasterKey: true });
    })(),
  ]);

  return {
    maxUsers: typeof tenant.get('MaxUsers') === 'number' ? tenant.get('MaxUsers') : null,
    currentUserCount,
    usedStorage: credits?.get('usedStorage') || 0,
  };
}
