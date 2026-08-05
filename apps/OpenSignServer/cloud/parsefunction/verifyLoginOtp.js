import { verifyOtp } from '../twoFactorAuth.js';

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

  return JSON.parse(pendingUserJson);
}
