async function getTenantByUserId(userId, contactId) {
  try {
    if (contactId) {
      const contactquery = new Parse.Query('contracts_Contactbook');
      contactquery.equalTo('objectId', contactId);
      const contactuser = await contactquery.first({ useMasterKey: true });
      if (contactuser) {
        const tenantId = contactuser?.get('TenantId')?.id;
        if (tenantId) {
          const tenantCreditsQuery = new Parse.Query('partners_Tenant');
          tenantCreditsQuery.equalTo('objectId', tenantId);
          const res = await tenantCreditsQuery.first({ useMasterKey: true });
          // exclude() rejects with a literal undefined on this Parse
          // version, so drop the sensitive fields off the fetched copy.
          if (res) { res.unset('FileAdapters'); res.unset('PfxFile'); res.unset('ContactNumber'); }
          return res;
        } else {
          return {};
        }
      } else {
        return {};
      }
    } else {
      const query = new Parse.Query('contracts_Users');
      query.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: userId });
      const extuser = await query.first({ useMasterKey: true });
      if (extuser) {
        const tenantId = extuser?.get('TenantId')?.id || '';
        const user = extuser?.get('CreatedBy')?.id || userId;
        const tenantQuery = new Parse.Query('partners_Tenant');
        if (tenantId) {
          tenantQuery.equalTo('objectId', tenantId);
        } else {
          tenantQuery.equalTo('UserId', {
            __type: 'Pointer',
            className: '_User',
            objectId: user,
          });
        }
        const res = await tenantQuery.first({ useMasterKey: true });
        if (res) { res.unset('FileAdapters'); res.unset('PfxFile'); }
        return res;
      } else {
        return {};
      }
    }
  } catch (err) {
    console.log('err in getTenant ', err);
    return 'user does not exist!';
  }
}
export default async function getTenant(request) {
  const userId = request.params.userId || '';
  const contactId = request.params.contactId || '';

  if (userId || contactId) {
    return await getTenantByUserId(userId, contactId);
  } else {
    return {};
  }
}
