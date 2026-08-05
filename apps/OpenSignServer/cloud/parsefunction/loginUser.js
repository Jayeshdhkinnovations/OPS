import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createAndSendOtp } from '../twoFactorAuth.js';

export default async function loginUser(request) {
  const username = request.params.email;
  const password = request.params.password;

  if (username && password) {
    try {
      // 1. Try to log in locally first (works for company-specific mounts or single-tenant default)
      const user = await Parse.User.logIn(username, password);
      if (user) {
        const _user = user?.toJSON();

        // If this account has 2FA turned on, the password alone isn't
        // enough - withhold the real session token (never send it to the
        // client), email a one-time code, and require verifyLoginOtp to
        // hand back the session before the frontend can proceed.
        const extUserQuery = new Parse.Query('contracts_Users');
        extUserQuery.equalTo('UserId', { __type: 'Pointer', className: '_User', objectId: user.id });
        const extUser = await extUserQuery.first({ useMasterKey: true });
        if (extUser?.get('TwoFactorEnabled')) {
          await createAndSendOtp(extUser, 'login', { PendingUserJson: JSON.stringify(_user) });
          return { requires2fa: true, userId: extUser.id };
        }

        return {
          ..._user,
        };
      } else {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'user not found.');
      }
    } catch (err) {
      // 2. If login fails, check if we are on the root instance and if this email belongs to a dynamic company
      const originalPath = request.headers ? request.headers['x-original-path'] : '';
      const isRootInstance = !originalPath || originalPath.startsWith('/app/functions') || originalPath.startsWith('/app/login') || originalPath === '/app' || originalPath === '/app/';
      console.log('DEBUG LOGIN REDIRECT:', { originalPath, isRootInstance, hasUri: !!process.env.SUPERADMIN_MONGODB_URI, username });
      if (isRootInstance && process.env.SUPERADMIN_MONGODB_URI) {
        try {
          const client = new MongoClient(process.env.SUPERADMIN_MONGODB_URI);
          await client.connect();
          const db = client.db();
          const company = await db.collection('Company').findOne({
            adminEmail: username,
            status: 'active'
          });
          await client.close();

          if (company && company.subdomain) {
            return {
              error: 'tenant_redirect',
              subdomain: company.subdomain
            };
          }
        } catch (superAdminErr) {
          console.error('Error querying SuperAdmin for tenant redirect:', superAdminErr);
        }
      }

      console.log('err in login user', err);
      throw err;
    }
  } else {
    throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'username/password is missing.');
  }
}

