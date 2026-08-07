// Sensitive fields that must never reach the client. These used to be
// dropped with Parse.Query.exclude(), but exclude() rejects with a literal
// `undefined` on this Parse version - which is what made every login fail
// at "Something went wrong" with no error to go on. Unsetting them on the
// fetched objects achieves the same thing; unset() only touches the
// in-memory copy, nothing is written back.
// Rebuilt from JSON rather than unset() on the fetched object: unset()
// leaves the object dirty, and Parse serialises a dirty object back to the
// caller as a bare Pointer, so the client got {__type:"Pointer"} with none
// of the fields it needs. fromJSON() produces a clean object that
// serialises in full.
function stripSensitiveFields(extUser) {
  if (!extUser) return extUser;
  const json = extUser.toJSON();
  delete json.google_refresh_token;
  if (json.TenantId && typeof json.TenantId === 'object') {
    delete json.TenantId.FileAdapters;
    delete json.TenantId.PfxFile;
  }
  if (json.CreatedBy && typeof json.CreatedBy === 'object') {
    delete json.CreatedBy.authData;
  }
  return Parse.Object.fromJSON({ className: 'contracts_Users', ...json });
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
