// Turning 2FA off only requires an authenticated session (the user already
// proved who they are to get one) - no extra OTP step, matching how most
// apps handle disabling MFA once you're already logged in.
export default async function disableTwoFactor(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token.');
  }
  const extUserQuery = new Parse.Query('contracts_Users');
  extUserQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: request.user.id });
  const extUser = await extUserQuery.first({ useMasterKey: true });
  if (!extUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
  }

  extUser.set('TwoFactorEnabled', false);
  await extUser.save(null, { useMasterKey: true });

  return { twoFactorEnabled: false };
}
