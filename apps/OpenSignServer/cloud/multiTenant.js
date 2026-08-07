// Multi-tenant mounting: this one backend process hosts a separate Parse
// Server instance per company, each bound to that company's own isolated
// database, all reachable under this same origin at /app/<slug>.
//
// Companies get added here in two ways:
//   1. On startup - every company already in the control plane's Company
//      collection gets mounted before this process starts accepting
//      traffic, so a restart (deploy, crash, reboot) doesn't lose anyone.
//   2. Live, via mountCompany() - called from the /admin/mount-company
//      endpoint the moment SuperAdminServer finishes provisioning a new
//      company. This adds the new mount to the already-running Express
//      app without restarting anything, so every other company's active
//      session is completely unaffected.
import { MongoClient } from 'mongodb';
import { ParseServer } from 'parse-server';
import { serverAppId, appName, superAdminMongoUri, buildMountServerUrl } from '../Utils.js';
import registerCloudCode from './main.js';

const mountedCompanies = new Map(); // slug -> { databaseName }
// Express has no clean way to un-register a mounted sub-app, so a removed
// company is gated at the door instead - the route stays technically
// mounted, but every request to it is rejected before ever reaching the
// (now stale, pointed-at-a-deleted-database) Parse Server instance behind it.
const removedSlugs = new Set();

export function isMounted(slug) {
  return mountedCompanies.has(slug);
}

export function listMountedSlugs() {
  return [...mountedCompanies.keys()];
}

export function unmountCompany(slug) {
  removedSlugs.add(slug);
  mountedCompanies.delete(slug);
}

// sharedParts carries the pieces every company's Parse Server instance
// should have in common - same file storage, same email delivery, same
// master key - only the database and URLs differ per company.
function buildCompanyConfig(slug, databaseName, sharedParts) {
  const serverURL = buildMountServerUrl(slug);
  const mongoUriBase = process.env.MONGODB_URI
    ? process.env.MONGODB_URI.replace(/\/[^/]+$/, '')
    : 'mongodb://localhost:27017';
  const fullDatabaseURI = databaseName.startsWith('mongodb')
    ? databaseName
    : `${mongoUriBase}/${databaseName}`;

  return {
    databaseURI: fullDatabaseURI,
    cloud: function () {
      registerCloudCode();
    },
    appId: `opensign_${slug}`,
    logLevel: ['error'],
    maxLimit: 500,
    maxUploadSize: '100mb',
    masterKey: process.env.MASTER_KEY,
    masterKeyIps: ['0.0.0.0/0', '::/0'],
    serverURL,
    publicServerURL: serverURL,
    verifyUserEmails: false,
    appName,
    allowClientClassCreation: false,
    allowExpiredAuthDataToken: false,
    enableInsecureAuthAdapters: false,
    databaseOptions: { allowPublicExplain: false },
    encodeParseObjectInCloudFunction: true,
    filesAdapter: sharedParts.fsAdapter,
    auth: sharedParts.auth,
    push: { queueOptions: { disablePushWorker: true } },
    ...(sharedParts.emailAdapter ? { emailAdapter: sharedParts.emailAdapter } : {}),
  };
}

// Mounts one company onto the given Express app. Safe to call again for a
// slug that's already mounted - it's a no-op, since the point of hot
// mounting is never disturbing a company that's already live.
export async function mountCompany({ slug, databaseName }, app, sharedParts) {
  if (!slug || !databaseName) {
    throw new Error('mountCompany requires both slug and databaseName');
  }
  if (mountedCompanies.has(slug)) {
    return { alreadyMounted: true, slug };
  }

  removedSlugs.delete(slug); // allow a deleted-then-recreated slug to work again
  const config = buildCompanyConfig(slug, databaseName, sharedParts);
  const server = new ParseServer(config);
  await server.start();
  app.use(`/app/${slug}`, (req, res, next) => {
    if (removedSlugs.has(slug)) return res.status(404).json({ error: 'Company not found' });
    const tenantAppId = `opensign_${slug}`;
    req.headers['x-parse-application-id'] = tenantAppId;
    if (req.body && req.body._ApplicationId) {
      req.body._ApplicationId = tenantAppId;
    }
    if (req.query && req.query._ApplicationId) {
      req.query._ApplicationId = tenantAppId;
    }
    next();
  });
  app.use(`/app/${slug}`, server.app);
  mountedCompanies.set(slug, { databaseName });

  console.log(`multiTenant: mounted company "${slug}" -> ${databaseName}`);
  return { alreadyMounted: false, slug };
}

// Wraps a root-instance Parse Server app (mounted at bare /app in
// index.js) so it never swallows requests meant for a company mount.
// Necessary because Express checks middleware in registration order, and
// the root instance is registered once at startup - long before most
// companies exist, including any added later via hot-mount. Without this
// guard, a request to /app/<slug>/... would hit the root mount first
// (its prefix /app matches), and since the root Parse Server doesn't
// recognize "/<slug>/..." as one of its own routes, it would 404 the
// request directly instead of letting Express fall through to the real
// company mount registered elsewhere in the stack.
export function guardRootMount(rootApp) {
  return (req, res, next) => {
    const firstSegment = req.path.split('/').filter(Boolean)[0];
    if (firstSegment && isMounted(firstSegment)) return next();
    return rootApp(req, res, next);
  };
}

// Reads every company from the control plane's Company collection
// directly (read-only) and mounts each active one. Called once at
// startup so a restart never loses an existing company.
export async function loadAllCompaniesAndMount(app, sharedParts) {
  const client = new MongoClient(superAdminMongoUri);
  try {
    await client.connect();
    const companies = await client
      .db()
      .collection('Company')
      .find({ status: 'active' })
      .toArray();

    for (const company of companies) {
      const slug = company.subdomain;
      const databaseName = company.databaseName;
      if (!slug || !databaseName) continue;
      try {
        await mountCompany({ slug, databaseName }, app, sharedParts);
      } catch (err) {
        // One bad company shouldn't stop every other one from mounting.
        console.log(`multiTenant: failed to mount "${slug}": ${err.message}`);
      }
    }
    console.log(`multiTenant: mounted ${mountedCompanies.size} compan${mountedCompanies.size === 1 ? 'y' : 'ies'} on startup.`);
  } finally {
    await client.close();
  }
}
