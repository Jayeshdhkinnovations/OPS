import { verifyOtp } from '../twoFactorAuth.js';
import { notifyLogin, clientInfo } from '../securityNotifications.js';

// Called from the login page's OTP step (unauthenticated - the user doesn't
// have a usable session yet). loginUser.js already verified the password and
// stashed the real session's user JSON (including sessionToken) on the OTP
// record instead of returning it directly; this is the only place that
// token is ever handed to the client, and only after the correct code is
// supplied.
export default async function verifyLoginOtp(request) {
  const { userId, otp } = request.params;
  if (!userId || !otp) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'userId and otp are both required.');
  }

  const record = await verifyOtp(userId, 'login', otp);
  const pendingUserJson = record.get('PendingUserJson');
  if (!pendingUserJson) {
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Could not complete login. Please try again.');
  }

  // The 2FA login only counts as complete here, so this is where its
  // sign-in alert belongs. Not awaited - see securityNotifications.js.
  try {
    const extUser = await new Parse.Query('contracts_Users').get(userId, { useMasterKey: true });
    if (extUser) notifyLogin(extUser, clientInfo(request));
  } catch (err) {
    console.log('login alert lookup failed:', err?.message || err);
  }

  return JSON.parse(pendingUserJson);
}
