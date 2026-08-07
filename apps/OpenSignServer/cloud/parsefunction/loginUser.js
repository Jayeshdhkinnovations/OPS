import crypto from 'node:crypto';

import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import { createAndSendOtp } from '../twoFactorAuth.js';
import { notifyLogin, clientInfo } from '../securityNotifications.js';


// Each company now runs in its own container with exactly one Parse Server
// (see cloud/multiTenant.js), so the SDK's process-global state can no
// longer be overwritten by another company. That means a plain
// Parse.User.logIn() authenticates against the right database again, and
// the explicit REST-call workaround this used to need is gone.
export default async function loginUser(request) {
  const username = request.params.email;
  const password = request.params.password;

  if (username && password) {
    try {
      const user = await Parse.User.logIn(username, password);
      if (user) {
        const _user = user.toJSON();

        // If this account has 2FA turned on, the password alone isn't
        // enough - withhold the real session token (never send it to the
        // client), email a one-time code, and require verifyLoginOtp to
        // hand back the session before the frontend can proceed.
        const extUserQuery = new Parse.Query('contracts_Users');
        extUserQuery.equalTo('UserId', {
          __type: 'Pointer',
          className: '_User',
          objectId: user.id,
        });
        const extUser = await extUserQuery.first({ useMasterKey: true });
        if (extUser?.get('TwoFactorEnabled')) {
          await createAndSendOtp(extUser, 'login', { PendingUserJson: JSON.stringify(_user) });
          return { requires2fa: true, userId: extUser.id };
        }

        // Deliberately not awaited: the sign-in alert is a courtesy, and a
        // slow or dead SMTP host must not delay or fail the login itself.
        // (The 2FA path above returns before this - that login isn't complete
        // yet; verifyLoginOtp sends the alert once the code checks out.)
        if (extUser) notifyLogin(extUser, clientInfo(request));

        return { ..._user };
      }
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'user not found.');
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

          // The same address can legitimately exist in more than one
          // company - the same person may admin two of them, and an email
          // that is one company's admin can also be an ordinary user in
          // another. So collect every company holding this address and let
          // the PASSWORD decide which one is meant; redirecting to the
          // first match sent correct credentials to the wrong company,
          // which rejected them as "Invalid username/password".
          const companies = await db
            .collection('Company')
            .find({ status: 'active' }, { projection: { subdomain: 1, databaseName: 1 } })
            .toArray();

          const candidates = [];
          for (const company of companies) {
            if (!company.databaseName || !company.subdomain) continue;
            const match = await client
              .db(company.databaseName)
              .collection('_User')
              .findOne(
                { $or: [{ username: username }, { email: username }] },
                { projection: { _hashed_password: 1 } }
              );
            if (match) candidates.push({ company, hash: match._hashed_password });
          }

          if (candidates.length === 1) {
            console.log(`TENANT LOOKUP: matched "${username}" in ${candidates[0].company.databaseName}`);
            return { error: 'tenant_redirect', subdomain: candidates[0].company.subdomain };
          }
          if (candidates.length > 1) {
            for (const c of candidates) {
              if (c.hash && (await bcrypt.compare(password, c.hash))) {
                console.log(
                  `TENANT LOOKUP: "${username}" exists in ${candidates.length} companies; password matched ${c.company.databaseName}`
                );
                return { error: 'tenant_redirect', subdomain: c.company.subdomain };
              }
            }
            // Password matched none of them - fall through to the normal
            // invalid-credentials error rather than guessing a company.
            console.log(
              `TENANT LOOKUP: "${username}" exists in ${candidates.length} companies but the password matched none`
            );
          }
          console.log(
            `TENANT LOOKUP: no company owns "${username}" (scanned ${companies.length}: ${companies
              .map(c => c.databaseName)
              .join(', ')})`
          );
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

