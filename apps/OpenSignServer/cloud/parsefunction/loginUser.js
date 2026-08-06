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
        let client;
        try {
          client = new MongoClient(process.env.SUPERADMIN_MONGODB_URI);
          await client.connect();
          const db = client.db();

          // Fast path: this email is a company's own admin address.
          const adminCompany = await db.collection('Company').findOne({
            adminEmail: username,
            status: 'active',
          });
          if (adminCompany?.subdomain) {
            return { error: 'tenant_redirect', subdomain: adminCompany.subdomain };
          }

          // Otherwise it may be a regular user created *inside* a company
          // (via Add User), whose email is nobody's adminEmail. Those users
          // are real but live only in their company's own database, so the
          // adminEmail lookup above can never find them - search each active
          // company's _User collection to work out which tenant owns them.
          // Same connection, different db, so this is N queries not N connections.
          const companies = await db
            .collection('Company')
            .find({ status: 'active' }, { projection: { subdomain: 1, databaseName: 1 } })
            .toArray();

          for (const company of companies) {
            if (!company.databaseName || !company.subdomain) continue;
            const match = await client
              .db(company.databaseName)
              .collection('_User')
              .findOne({ $or: [{ username: username }, { email: username }] }, { projection: { _id: 1 } });
            if (match) {
              return { error: 'tenant_redirect', subdomain: company.subdomain };
            }
          }
        } catch (superAdminErr) {
          console.error('Error querying SuperAdmin for tenant redirect:', superAdminErr);
        } finally {
          // Previously only closed on the happy path, leaking a connection
          // whenever the lookup threw.
          await client?.close().catch(() => {});
        }
      }

      console.log('err in login user', err);
      throw err;
    }
  } else {
    throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'username/password is missing.');
  }
}

