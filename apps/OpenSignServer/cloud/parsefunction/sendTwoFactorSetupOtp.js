import { createAndSendOtp } from '../twoFactorAuth.js';

// Called when the user flips the 2FA toggle on in their Profile - emails a
// code that proves they actually own this inbox before the toggle takes
// effect (see verifyTwoFactorSetupOtp.js, which is what actually turns it on).
export default async function sendTwoFactorSetupOtp(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token.');
  }
  const extUserQuery = new Parse.Query('contracts_Users');
  extUserQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: request.user.id });
  const extUser = await extUserQuery.first({ useMasterKey: true });
  if (!extUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
  }

  await createAndSendOtp(extUser, 'setup');
  return { sent: true };
}
