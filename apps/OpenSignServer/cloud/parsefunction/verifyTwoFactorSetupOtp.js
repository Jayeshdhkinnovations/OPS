import { verifyOtp } from '../twoFactorAuth.js';

// Confirms the code sent by sendTwoFactorSetupOtp.js and, only on success,
// actually flips TwoFactorEnabled on for this user.
export default async function verifyTwoFactorSetupOtp(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Invalid session token.');
  }
  const { otp } = request.params;
  if (!otp) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'otp is required.');
  }

  const extUserQuery = new Parse.Query('contracts_Users');
  extUserQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: request.user.id });
  const extUser = await extUserQuery.first({ useMasterKey: true });
  if (!extUser) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
  }

  await verifyOtp(extUser.id, 'setup', otp);

  extUser.set('TwoFactorEnabled', true);
  await extUser.save(null, { useMasterKey: true });

  return { twoFactorEnabled: true };
}
