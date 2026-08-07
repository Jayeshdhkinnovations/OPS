import crypto from 'node:crypto';
import axios from 'axios';
import { MongoClient } from 'mongodb';
import { createAndSendOtp } from '../twoFactorAuth.js';
import { serverAppId } from '../../Utils.js';

// Parse's SDK globals (Parse.serverURL / Parse.applicationId) are set by
// ParseServer's constructor - process-wide, not per instance. With one
// instance per company in a single process, the LAST company mounted wins,
// so a bare `Parse.User.logIn()` inside cloud code authenticates against
// whichever company happened to mount last rather than the one that
// actually received the request. That silently fails every login for
// everyone else ("user is in the database but can't log in").
//
// So resolve the mount from the request path and talk to that mount's own
// REST endpoint explicitly. Deterministic, and immune to the global-state
// race that mutating Parse.serverURL per request would introduce.
function resolveMount(request) {
  const originalPath = request.headers?.['x-original-path'] || '';
  const match = originalPath.match(/^\/app\/([^/?]+)\//);
  const segment = match?.[1];
  // /app/functions/... is the root instance; /app/<slug>/functions/... is a company.
  const isCompanyMount = segment && segment !== 'functions' && segment !== 'login';
  const port = process.env.PORT || 8081;
  return isCompanyMount
    ? { baseUrl: `http://127.0.0.1:${port}/app/${segment}`, appId: `opensign_${segment}` }
    : { baseUrl: `http://127.0.0.1:${port}/app`, appId: serverAppId };
}

export default async function loginUser(request) {
  const username = request.params.email;
  const password = request.params.password;

  if (username && password) {
    const mount = resolveMount(request);
    try {
      // 1. Authenticate against the mount that actually received this
      //    request (see resolveMount above for why this isn't Parse.User.logIn).
      // Deliberately NO master key here: /login is a public endpoint, and a
      // master-key request is treated as already-authenticated, so Parse
      // returns the user without minting a usable session. The frontend then
      // calls Parse.User.become(undefined) and gets "Invalid session token".
      const loginRes = await axios.post(
        `${mount.baseUrl}/login`,
        { username, password },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Parse-Application-Id': mount.appId,
          },
        }
      );
      const _user = loginRes.data;
      if (_user?.objectId && !_user?.sessionToken) {
        // Fail loudly rather than handing the frontend a session-less user
        // that only breaks later at become().
        console.log('loginUser: login succeeded but no sessionToken returned', {
          mount: mount.baseUrl,
          appId: mount.appId,
        });
        throw new Parse.Error(
          Parse.Error.INTERNAL_SERVER_ERROR,
          'Login succeeded but no session was created. Please try again.'
        );
      }
      if (_user?.objectId) {
        // If this account has 2FA turned on, the password alone isn't
        // enough - withhold the real session token (never send it to the
        // client), email a one-time code, and require verifyLoginOtp to
        // hand back the session before the frontend can proceed.
        const extRes = await axios.get(`${mount.baseUrl}/classes/contracts_Users`, {
          params: {
            where: JSON.stringify({
              UserId: { __type: 'Pointer', className: '_User', objectId: _user.objectId },
            }),
            limit: 1,
          },
          headers: {
            'X-Parse-Application-Id': mount.appId,
            'X-Parse-Master-Key': process.env.MASTER_KEY,
          },
        });
        const extUser = extRes.data?.results?.[0];
        if (extUser?.TwoFactorEnabled) {
          await createAndSendOtp(
            { id: extUser.objectId, get: field => extUser[field] },
            'login',
            { PendingUserJson: JSON.stringify(_user) }
          );
          return { requires2fa: true, userId: extUser.objectId };
        }

        return { ..._user };
      }
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'user not found.');
    } catch (rawErr) {
      // Normalize an axios failure back into the ParseError the frontend expects.
      const parseBody = rawErr?.response?.data;
      const err = parseBody?.code
        ? new Parse.Error(parseBody.code, parseBody.error || 'Invalid username/password.')
        : rawErr;
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
              console.log(`TENANT LOOKUP: matched "${username}" in ${company.databaseName}`);
              return { error: 'tenant_redirect', subdomain: company.subdomain };
            }
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

