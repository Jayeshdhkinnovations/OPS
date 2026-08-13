import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';
import { verifyGoogleIdToken } from '../firebaseAdmin.js';
import { notifyLogin, clientInfo } from '../securityNotifications.js';

// Runs inside the COMPANY's own container/database, after the frontend has
// already re-pointed itself here using googleLoginLookup's answer (same
// pattern as the email/password flow's tenant_redirect).
//
// Re-verifies the token rather than trusting the root lookup's word for it -
// cheap, and it means this function is safe to call directly too, not just
// as the second half of a lookup.
export default async function googleLogin(request) {
  const { idToken } = request.params;
  const { googleId, email } = await verifyGoogleIdToken(idToken);

  // GoogleUid is a plain custom field, not Parse's authData - see the note
  // in provisionCompany.js for why: Parse's built-in Google adapter, already
  // configured on every mount, would otherwise intercept any authData.google
  // and demand a raw Google id_token this Firebase token can't satisfy.
  //
  // Matched on the Google-native id (see firebaseAdmin.js), not Firebase's
  // own uid - the pending signup's Firebase user record was deleted before
  // approval, so a fresh sign-in here gets a brand new Firebase uid; the
  // Google-native id is what stayed constant and is what got stored.
  const userQuery = new Parse.Query(Parse.User);
  userQuery.equalTo('GoogleUid', googleId);
  const user = await userQuery.first({ useMasterKey: true });
  if (!user) {
    throw new Parse.Error(
      Parse.Error.OBJECT_NOT_FOUND,
      'No account linked to this Google sign-in here.'
    );
  }

  // Mints a real session for a known user without a password - the exact
  // same internal mechanism AuthLoginAsMail.js already uses for the OTP
  // guest-login flow, reused here instead of inventing a second one.
  const loginAsRes = await axios({
    method: 'POST',
    url: `${cloudServerUrl}/loginAs`,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'X-Parse-Application-Id': serverAppId,
      'X-Parse-Master-Key': process.env.MASTER_KEY,
    },
    params: { userId: user.id },
  });
  const _user = loginAsRes.data;
  if (!_user?.sessionToken) {
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Could not sign in.');
  }

  // Deliberately no 2FA gate here, unlike the password flow - Google already
  // proved who this is (a second factor in its own right), so a Google
  // sign-in goes straight through even on an account with 2FA turned on.
  // OTP is only ever asked for a plain username/password login.
  const extUserQuery = new Parse.Query('contracts_Users');
  extUserQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: user.id });
  const extUser = await extUserQuery.first({ useMasterKey: true });
  if (extUser) notifyLogin(extUser, clientInfo(request));

  if (email && !_user.emailVerified) {
    // Google already proved this address; nothing left for the user to
    // confirm, so don't leave "not verified" showing in their profile.
    const u = new Parse.User();
    u.id = user.id;
    u.set('emailVerified', true);
    await u.save(null, { useMasterKey: true }).catch(() => {});
    _user.emailVerified = true;
  }

  return { ..._user };
}
