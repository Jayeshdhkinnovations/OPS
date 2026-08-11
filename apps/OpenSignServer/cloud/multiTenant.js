// Multi-tenant routing: every company keeps its own database, and each one
// is served by its OWN container running a single Parse Server. This root
// process only proxies /app/<slug>/... through to the right container.
//
// It deliberately does NOT create Parse Server instances per company any
// more. Parse stores applicationId, serverURL and its REST controller as
// process-wide globals (ParseServer.js does `Parse.initialize(...)` and
// `Parse.serverURL = ...` on construction), so a second instance in the
// same process silently overwrites the first. Every cloud function then
// talked to whichever company mounted last, which showed up as
// "User is not authenticated" for everyone else. One process per company
// is the only arrangement where that cannot happen.
import http from 'node:http';
import { MongoClient } from 'mongodb';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { superAdminMongoUri } from '../Utils.js';

const execFileAsync = promisify(execFile);

// slug -> { databaseName, host, port }
const companyRoutes = new Map();

const COMPANY_PORT = 8081; // the port inside every company container
const CONTAINER_PREFIX = 'opensign-';
const IMAGE = process.env.COMPANY_IMAGE || 'opensign-app';
const DOCKER_NETWORK = process.env.DOCKER_NETWORK || 'appnet';

// Internal hostname of a company's container, for server-side calls that
// need to reach one directly (e.g. password reset, which has to run
// against the company that actually owns the account).
export function getCompanyHost(slug) {
  const route = companyRoutes.get(slug);
  return route ? { host: route.host, port: route.port } : null;
}

export function isMounted(slug) {
  return companyRoutes.has(slug);
}

export function listMountedSlugs() {
  return [...companyRoutes.keys()];
}

function containerName(slug) {
  return `${CONTAINER_PREFIX}${slug}`;
}

// Env passed to a company container. Everything the root has, except the
// database - which is what makes it that company's own instance.
function companyEnv(slug, databaseName) {
  const mongoBase = (process.env.MONGODB_URI || 'mongodb://mongo:27017/OpenSignDB').replace(
    /\/[^/]+$/,
    ''
  );
  const pass = [
    'MASTER_KEY',
    'APP_ID',
    'PUBLIC_ORIGIN',
    // Without this the company falls back to a stale default port and every
    // tenant lookup inside a company container fails with ECONNREFUSED.
    'SUPERADMIN_MONGODB_URI',
    'SMTP_ENABLE',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER_EMAIL',
    'SMTP_USERNAME',
    'SMTP_PASS',
    'PFX_BASE64',
    'PASS_PHRASE',
    'USE_LOCAL',
  ];
  const args = [];
  for (const key of pass) {
    if (process.env[key] !== undefined) args.push('-e', `${key}=${process.env[key]}`);
  }
  args.push('-e', `MONGODB_URI=${mongoBase}/${databaseName}`);
  // Without this the company container would run the root's startup path -
  // proxying, and starting company containers of its own, forever. It also
  // stops it reaching for SUPERADMIN_MONGODB_URI, which it has no business
  // touching and which isn't passed to it.
  args.push('-e', 'COMPANY_MODE=true');
  // Each company answers on /app inside its own container; the public URL
  // it advertises still has to include the slug so links back to it work.
  args.push('-e', `SERVER_URL=${process.env.PUBLIC_ORIGIN || ''}/app/${slug}`);
  args.push('-e', `PORT=${COMPANY_PORT}`);
  return args;
}

async function docker(args) {
  const { stdout } = await execFileAsync('docker', args, { timeout: 60000 });
  return stdout.trim();
}

async function containerState(name) {
  try {
    return await docker(['inspect', '-f', '{{.State.Status}}', name]);
  } catch {
    return null; // does not exist
  }
}

// Waits until the company's Parse Server answers, so callers that
// immediately start writing records don't race the container's startup.
async function waitForReady(host, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise(resolve => {
      const req = http.request(
        { host, port: COMPANY_PORT, path: '/app/health', method: 'GET', timeout: 3000 },
        res => {
          res.resume();
          resolve(res.statusCode > 0);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}

// Starts (or reuses) the container for one company and registers its route.
export async function mountCompany({ slug, databaseName }) {
  if (!slug || !databaseName) {
    throw new Error('mountCompany requires both slug and databaseName');
  }
  const name = containerName(slug);

  if (companyRoutes.has(slug)) {
    const state = await containerState(name);
    if (state === 'running') return { alreadyMounted: true, slug };
  }

  const state = await containerState(name);
  if (state === null) {
    await docker([
      'run',
      '-d',
      '--name',
      name,
      '--network',
      DOCKER_NETWORK,
      '--restart',
      'unless-stopped',
      // Uploaded and signed PDFs are written to the container's filesystem by
      // the Parse FS files adapter. Without this volume they lived only
      // inside the container, so every image rebuild silently destroyed every
      // document a company had ever signed. The volume is named per company
      // so one tenant's files can never be served to another.
      '-v',
      `opensign-files-${slug}:/app/files/files`,
      ...companyEnv(slug, databaseName),
      IMAGE,
    ]);
  } else if (state !== 'running') {
    await docker(['start', name]);
  }

  const ready = await waitForReady(name);
  if (!ready) {
    throw new Error(`company container "${name}" did not become ready in time`);
  }

  companyRoutes.set(slug, { databaseName, host: name, port: COMPANY_PORT });
  console.log(`multiTenant: company "${slug}" -> container ${name} (${databaseName})`);
  return { alreadyMounted: false, slug };
}

export async function unmountCompany(slug, { purge = false } = {}) {
  const name = containerName(slug);
  companyRoutes.delete(slug);
  try {
    await docker(['rm', '-f', name]);
    console.log(`multiTenant: removed container ${name}`);
  } catch (err) {
    console.log(`multiTenant: could not remove ${name}: ${err.message}`);
  }
  // Only on a real deletion. Dropping the database left every signed PDF
  // sitting in this volume, so a deleted company's documents survived and
  // would be handed straight back to the next company given the same slug.
  if (purge) {
    try {
      await docker(['volume', 'rm', '-f', `opensign-files-${slug}`]);
      console.log(`multiTenant: removed files volume for ${slug}`);
    } catch (err) {
      console.log(`multiTenant: could not remove volume for ${slug}: ${err.message}`);
    }
  }
}

// Proxies /app/<slug>/... to that company's container, stripping the slug
// (each container serves Parse at plain /app). Anything whose first segment
// isn't a known company falls through to the root instance.
export function companyProxy() {
  return (req, res, next) => {
    const segments = req.path.split('/').filter(Boolean);
    const slug = segments[0];
    const route = slug && companyRoutes.get(slug);
    if (!route) return next();

    const rest = req.originalUrl.replace(new RegExp(`^/app/${slug}`), '') || '/';
    const proxyReq = http.request(
      {
        host: route.host,
        port: route.port,
        path: `/app${rest}`,
        method: req.method,
        headers: { ...req.headers, host: `${route.host}:${route.port}` },
      },
      proxyRes => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', err => {
      console.log(`multiTenant: proxy to "${slug}" failed: ${err.message}`);
      if (!res.headersSent) res.status(502).json({ error: 'company backend unavailable' });
    });

    // express.json()/urlencoded() upstream only consume application/json,
    // text/plain and urlencoded bodies; for those the stream is already
    // drained, so the parsed body has to be replayed.
    //
    // Everything else still has an intact stream and must be piped through
    // byte-for-byte. File uploads arrive as multipart or a binary content
    // type, so they land here: re-encoding them as JSON (or worse, sending
    // nothing) is what made Parse reject every upload as "Invalid file
    // upload." - the request reached it with an empty body.
    // The decision must be made on content-type, NOT on whether req.body has
    // keys: a cloud function called with an empty body ({}) was parsed and
    // its stream drained just the same, so trying to pipe it would wait
    // forever on a stream that can never emit - which hung every such call
    // until the gateway timed out.
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    // /files/ is exempt from the body parsers in index.js (Parse installs its
    // own raw parser there), so its stream is always intact and must be piped
    // whatever the content type claims - the JS SDK labels base64 uploads
    // text/plain, which would otherwise be misread as already parsed.
    const isFileRoute = req.path.includes('/files/');
    const bodyAlreadyParsed =
      !isFileRoute &&
      /^(application\/json|text\/plain|application\/x-www-form-urlencoded)/.test(contentType);
    const hasBody = req.headers['content-length'] || req.headers['transfer-encoding'];

    if (bodyAlreadyParsed) {
      // Replay in the SAME encoding it arrived in. Re-encoding a form post as
      // JSON silently emptied it for Parse's own HTML pages, which read
      // urlencoded fields - that is what made the password-reset form fail
      // with "username / email / token is invalid" even on a valid token.
      const isForm = contentType.startsWith('application/x-www-form-urlencoded');
      const payload = isForm
        ? Buffer.from(new URLSearchParams(req.body ?? {}).toString())
        : Buffer.from(JSON.stringify(req.body ?? {}));
      proxyReq.setHeader(
        'content-type',
        isForm ? 'application/x-www-form-urlencoded' : 'application/json'
      );
      proxyReq.setHeader('content-length', payload.length);
      proxyReq.end(payload);
    } else if (hasBody && req.readable) {
      // Anything the parsers ignored - file uploads arrive as multipart or a
      // binary content type - still has its stream intact and is forwarded
      // byte-for-byte.
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  };
}

// Starts a container for every active company at boot, so a restart of this
// root process brings the whole platform back up.
export async function loadAllCompaniesAndMount() {
  const client = new MongoClient(superAdminMongoUri);
  try {
    await client.connect();
    const companies = await client.db().collection('Company').find({ status: 'active' }).toArray();

    for (const company of companies) {
      const slug = company.subdomain;
      const databaseName = company.databaseName;
      if (!slug || !databaseName) continue;
      try {
        await mountCompany({ slug, databaseName });
      } catch (err) {
        // One bad company shouldn't stop every other one from starting.
        console.log(`multiTenant: failed to start "${slug}": ${err.message}`);
      }
    }
    console.log(
      `multiTenant: ${companyRoutes.size} compan${companyRoutes.size === 1 ? 'y' : 'ies'} routed on startup.`
    );
  } finally {
    await client.close();
  }
}
