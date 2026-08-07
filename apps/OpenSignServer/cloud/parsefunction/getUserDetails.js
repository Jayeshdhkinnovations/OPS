// Sensitive fields that must never reach the client. These used to be
// dropped with Parse.Query.exclude(), but exclude() rejects with a literal
// `undefined` on this Parse version - which is what made every login fail
// at "Something went wrong" with no error to go on. Unsetting them on the
// fetched objects achieves the same thing; unset() only touches the
// in-memory copy, nothing is written back.
function stripSensitiveFields(extUser) {
  if (!extUser) return extUser;
  extUser.unset('google_refresh_token');

  const tenant = extUser.get('TenantId');
  if (tenant && typeof tenant.unset === 'function') {
    tenant.unset('FileAdapters');
    tenant.unset('PfxFile');
  }
  const createdBy = extUser.get('CreatedBy');
  if (createdBy && typeof createdBy.unset === 'function') {
    createdBy.unset('authData');
  }
  return extUser;
}

async function getUserDetails(request) {
  const reqEmail = request.params.email;
  if (reqEmail || request.user) {
    try {
      const userId = request.params.userId;
      const userQuery = new Parse.Query('contracts_Users');
      if (reqEmail) {
        userQuery.equalTo('Email', reqEmail);
      } else {
        const email = request.user.get('email');
        userQuery.equalTo('Email', email);
      }
      userQuery.include('TenantId');
      userQuery.include('UserId');
      userQuery.include('CreatedBy');
      if (userId) {
        userQuery.equalTo('CreatedBy', { __type: 'Pointer', className: '_User', objectId: userId });
      }
      const res = await userQuery.first({ useMasterKey: true });
      if (res) {
        if (reqEmail) {
          return { objectId: res.id };
        } else {
          return stripSensitiveFields(res);
        }
      } else {
        return '';
      }
    } catch (err) {
      console.log('Err ', err);
      const code = err?.code || 400;
      const msg = err?.message || 'Something went wrong.';
      throw new Parse.Error(code, msg);
    }
  } else {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
}
export default getUserDetails;
