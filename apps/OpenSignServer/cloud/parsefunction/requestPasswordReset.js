import http from 'node:http';
import { MongoClient } from 'mongodb';
import { getCompanyHost } from '../multiTenant.js';

// Password reset from the shared login page.
//
// Accounts don't live in the root database - each company has its own - so
// Parse.User.requestPasswordReset() called against the root found no user,
// silently returned {} (Parse never reveals whether an address exists) and
// sent nothing. Login already routes to the owning company; this does the
// same for the reset, then asks THAT company's server to send the mail, so
// the link it generates points back at the right tenant.
function postToCompany(host, port, email) {
  return new Promise(resolve => {
    const payload = JSON.stringify({ email });
    const req = http.request(
      {
        host,
        port,
        path: '/app/requestPasswordReset',
        method: 'POST',
        timeout: 20000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Parse-Application-Id': process.env.APP_ID || 'opensign',
        },
      },
      res => {
        res.resume();
        resolve(res.statusCode);
      }
    );
    req.on('error', err => {
      console.log(`requestpasswordreset: company request failed: ${err.message}`);
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end(payload);
  });
}

export default async function requestPasswordReset(request) {
  const email = request.params?.email?.toLowerCase()?.trim();
  // Always resolve the same way regardless of outcome - revealing which
  // addresses exist would let anyone enumerate the user base.
  if (!email || !process.env.SUPERADMIN_MONGODB_URI) return {};

  let client;
  try {
    client = new MongoClient(process.env.SUPERADMIN_MONGODB_URI);
    await client.connect();
    const companies = await client
      .db()
      .collection('Company')
      .find({ status: 'active' }, { projection: { subdomain: 1, databaseName: 1 } })
      .toArray();

    for (const company of companies) {
      if (!company.databaseName || !company.subdomain) continue;
      const match = await client
        .db(company.databaseName)
        .collection('_User')
        .findOne({ $or: [{ username: email }, { email }] }, { projection: { _id: 1 } });
      if (!match) continue;

      const route = getCompanyHost(company.subdomain);
      if (!route) {
        console.log(`requestpasswordreset: "${company.subdomain}" has no running container`);
        continue;
      }
      const status = await postToCompany(route.host, route.port, email);
      console.log(
        `requestpasswordreset: sent for "${email}" via ${company.subdomain} (status ${status})`
      );
      // An address can exist in more than one company; mail every one that
      // has it, since we can't tell which the person meant without a password.
    }
  } catch (err) {
    console.log(`requestpasswordreset failed: ${err.message}`);
  } finally {
    await client?.close().catch(() => {});
  }

  return {};
}
