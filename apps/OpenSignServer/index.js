import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import express from 'express';
import cors from 'cors';
import path from 'path';
const __dirname = path.resolve();
import http from 'http';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { ApiPayloadConverter } from 'parse-server-api-mail-adapter';
import S3Adapter from '@parse/s3-files-adapter';
import FSFilesAdapter from '@parse/fs-files-adapter';
import { app as customRoute } from './cloud/customRoute/customApp.js';
import { createTransport } from 'nodemailer';
import { ParseServer } from 'parse-server';
import {
  appName,
  smtpenable,
  smtpsecure,
  useLocal,
  internalAdminSecret,
  serverAppId,
  publicOrigin,
} from './Utils.js';
import { BRAND_NAME } from './cloud/emailTemplates.js';
import { SSOAuth } from './auth/authadapter.js';
import { validateSignedLocalUrl } from './cloud/parsefunction/getSignedUrl.js';
import {
  mountCompany,
  unmountCompany,
  loadAllCompaniesAndMount,
  listMountedSlugs,
  companyProxy,
} from './cloud/multiTenant.js';
import registerCloudCode from './cloud/main.js';
let fsAdapter;

if (useLocal !== 'true') {
  try {
    // const spacesEndpoint = new AWS.Endpoint(process.env.DO_ENDPOINT);
    const spacesEndpoint = process.env.DO_ENDPOINT?.includes('http')
      ? process.env.DO_ENDPOINT
      : `https://${process.env.DO_ENDPOINT}`; //"e.g https://blr1.digitaloceanspaces.com"
    const s3Options = {
      bucket: process.env.DO_SPACE,
      baseUrl: process.env.DO_BASEURL,
      fileAcl: 'none',
      region: process.env.DO_REGION,
      directAccess: true,
      preserveFileName: true,
      presignedUrl: true,
      presignedUrlExpires: 900,
      s3overrides: {
        credentials: {
          accessKeyId: process.env.DO_ACCESS_KEY_ID,
          secretAccessKey: process.env.DO_SECRET_ACCESS_KEY,
        },
        endpoint: spacesEndpoint,
        signatureVersion: 'v4',
      },
    };
    fsAdapter = new S3Adapter(s3Options);
  } catch (err) {
    console.log('Please provide AWS credintials in env file! Defaulting to local storage.');
    fsAdapter = new FSFilesAdapter({
      filesSubDirectory: 'files', // optional, defaults to ./files
    });
  }
} else {
  fsAdapter = new FSFilesAdapter({
    filesSubDirectory: 'files', // optional, defaults to ./files
  });
}

let transporterMail;
let mailgunClient;
let mailgunDomain;
let isMailAdapter = false;
if (smtpenable) {
  try {
    let transporterConfig = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 465,
      secure: smtpsecure,
    };

    // ✅ Add auth only if BOTH username & password exist
    const smtpUser = process.env.SMTP_USERNAME;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpUser && smtpPass) {
      transporterConfig.auth = {
        user: process.env.SMTP_USERNAME ? process.env.SMTP_USERNAME : process.env.SMTP_USER_EMAIL,
        pass: smtpPass,
      };
    }
    transporterMail = createTransport(transporterConfig);
    await transporterMail.verify();
    isMailAdapter = true;
  } catch (err) {
    isMailAdapter = false;
    console.log(`Please provide valid SMTP credentials: ${err}`);
  }
} else if (process.env.MAILGUN_API_KEY) {
  try {
    const mailgun = new Mailgun(formData);
    mailgunClient = mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY,
    });
    mailgunDomain = process.env.MAILGUN_DOMAIN;
    isMailAdapter = true;
  } catch (error) {
    isMailAdapter = false;
    console.log('Please provide valid Mailgun credentials');
  }
}
const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;

// These pieces are shared across every company's Parse Server mount - same
// file storage, same outgoing mail, same auth providers. Only the database
// and URLs differ per company (see cloud/multiTenant.js buildCompanyConfig).
const sharedParts = {
  fsAdapter,
  auth: { google: { clientId: process.env.GOOGLE_CLIENT_ID }, sso: SSOAuth },
  ...(isMailAdapter === true
    ? {
        emailAdapter: {
          module: 'parse-server-api-mail-adapter',
          options: {
            // SignToowix, not `appName` ("SignToowix") - these are the
            // platform's own account emails, not document-signing mail.
            sender: BRAND_NAME + ' <' + mailsender + '>',
            templates: {
              passwordResetEmail: {
                subjectPath: './files/password_reset_email_subject.txt',
                textPath: './files/password_reset_email.txt',
                htmlPath: './files/password_reset_email.html',
              },
              verificationEmail: {
                subjectPath: './files/verification_email_subject.txt',
                textPath: './files/verification_email.txt',
                htmlPath: './files/verification_email.html',
              },
            },
            apiCallback: async ({ payload, locale }) => {
              if (mailgunClient) {
                const mailgunPayload = ApiPayloadConverter.mailgun(payload);
                await mailgunClient.messages.create(mailgunDomain, mailgunPayload);
              } else if (transporterMail) await transporterMail.sendMail(payload);
            },
          },
        },
      }
    : {}),
};

export const app = express();
app.use(cors());
// Also parse text/plain: the Parse JS SDK deliberately sends its POST
// bodies as text/plain to dodge a CORS preflight. Without this they stay
// unparsed here, so the per-company middleware in multiTenant.js can't
// rewrite the _ApplicationId inside the body - it only fixes the header.
// Parse then sees header appId opensign_<slug> against body appId
// opensign, treats the pair as inconsistent, and rejects the session with
// "Permission denied" (209) on every authenticated tenant request.
//
// File uploads are the one exception. Parse.File built from a byte array is
// sent by the JS SDK as base64 JSON under that same text/plain content type,
// and Parse Server's own /files/ route installs a raw body parser expecting
// a Buffer. If the JSON parser below consumes that stream first, Parse sees
// req.body as a plain object with no `.length` and rejects every browser
// upload with "Invalid file upload." So /files/ is skipped here and left to
// Parse's own parser.
const jsonParser = express.json({ limit: '100mb', type: ['application/json', 'text/plain'] });
const urlencodedParser = express.urlencoded({ limit: '100mb', extended: true });
const isFileRoute = req => req.path.includes('/files/');
app.use((req, res, next) => (isFileRoute(req) ? next() : jsonParser(req, res, next)));
app.use((req, res, next) => (isFileRoute(req) ? next() : urlencodedParser(req, res, next)));
app.use(function (req, res, next) {
  req.headers['x-real-ip'] = getUserIP(req);
  // req.get('host') reflects THIS container's own view of the request - for
  // a company container reached through the root's proxy, that is not the
  // real public host at all. companyProxy() in multiTenant.js explicitly
  // rewrites the Host header to the internal container:port it forwards to
  // (e.g. opensign-creatfxstudio:8081), so any link built from the old
  // 'https://' + req.get('host') (a signer's "review and sign" URL, a
  // decline notice, a batch-doc callback) pointed at an address that only
  // resolves inside the Docker network and was completely unreachable from
  // outside it. Prefer the browser's own Origin header first - untouched by
  // the proxy hop (companyProxy forwards it unchanged via ...req.headers),
  // and correct even for a tenant's own custom domain if they have one, same
  // preference createBatchDocs.js already uses for this reason. Then this
  // container's own PUBLIC_ORIGIN, reliably set per company via
  // multiTenant.js's companyEnv() regardless of proxying. req.get('host') is
  // now only a last-resort fallback for the rare request with neither.
  const publicUrl =
    req.headers.origin || process.env.PUBLIC_ORIGIN || 'https://' + req?.get('host');
  req.headers['public_url'] = publicUrl;
  req.headers['x-original-path'] = req.originalUrl || req.url;
  next();
});
function getUserIP(request) {
  let forwardedFor = request.headers['x-forwarded-for'];
  if (forwardedFor) {
    if (forwardedFor.indexOf(',') > -1) {
      return forwardedFor.split(',')[0];
    } else {
      return forwardedFor;
    }
  } else {
    return request.socket.remoteAddress;
  }
}

app.use(async function (req, res, next) {
  const isFilePath = req.path?.includes('/files/') || false;
  if (isFilePath && req.method.toLowerCase() === 'get') {
    // SERVER_URL is this instance's PUBLIC base - for a company container
    // that includes its slug (https://host/app/<slug>), while req.originalUrl
    // is the INTERNAL path (/app/files/...) because the root proxy strips the
    // slug before forwarding. Signed-URL tokens are minted against the public
    // form, so rebuilding the public URL here is what makes them match;
    // using the bare origin dropped the slug and rejected every company's
    // files as unauthorized.
    const serverUrl = new URL(process.env.SERVER_URL);
    const publicBase = serverUrl.origin + serverUrl.pathname.replace(/\/+$/, '');
    const localPath = req.originalUrl.replace(/^\/app/, '');
    const fileUrl = publicBase + localPath;
    const params = fileUrl?.split('?')?.[1];
    if (params) {
      const fileRes = await validateSignedLocalUrl(fileUrl);
      if (fileRes === 'Unauthorized') {
        return res.status(400).json({ message: 'unauthorized' });
      }
    } else {
      return res.status(400).json({ message: 'unauthorized' });
    }
    next();
  } else {
    next();
  }
});

// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')));

// Serve the default Parse API on the /app URL prefix (fallback for root public functions)
const mountPath = process.env.PARSE_MOUNT || '/app';
const defaultServerConfig = {
  databaseURI: process.env.MONGODB_URI || 'mongodb://localhost:27030/OpenSignDB',
  cloud: function () {
    registerCloudCode();
  },
  appId: serverAppId,
  masterKey: process.env.MASTER_KEY,
  masterKeyIps: ['0.0.0.0/0', '::/0'],
  // Honour SERVER_URL when it is set. A company container is reached at
  // /app/<slug> from outside but serves Parse at plain /app internally, so
  // deriving this from PUBLIC_ORIGIN + mountPath dropped the slug - and
  // every link Parse generates (password reset, email verification) then
  // pointed at the root, whose database has none of those tokens. That is
  // what produced "Invalid Link" on an otherwise valid reset mail.
  serverURL: process.env.SERVER_URL || `${publicOrigin}${mountPath}`,
  publicServerURL: process.env.SERVER_URL || `${publicOrigin}${mountPath}`,
  appName,
  allowClientClassCreation: true,
  encodeParseObjectInCloudFunction: true,
  filesAdapter: sharedParts.fsAdapter,
  auth: sharedParts.auth,
  push: { queueOptions: { disablePushWorker: true } },
  ...(sharedParts.emailAdapter ? { emailAdapter: sharedParts.emailAdapter } : {}),
  // Reset-password links never expired before this (Parse Server's default
  // is "never"). Scoped to only the reset-password token - no other
  // passwordPolicy behavior (complexity rules, reuse, etc.) is enabled.
  passwordPolicy: { resetTokenValidityDuration: 3600 },
};
const defaultServer = new ParseServer(defaultServerConfig);
await defaultServer.start();
// A company container runs this exact same file, but must behave as a
// plain single-tenant server: no proxying, and above all no starting of
// further company containers (which would recurse forever).
const isCompanyMode = process.env.COMPANY_MODE === 'true';

// Company traffic (/app/<slug>/...) is proxied to that company's own
// container before the root instance ever sees it; anything else falls
// through to the root Parse Server below.
if (!isCompanyMode) {
  app.use(mountPath, companyProxy());
}
app.get('/app/health', (req, res) => res.status(200).json({ ok: true }));
// The multi-tenant proxy forwards a company's request to its container with
// the `/app` prefix intact (see companyProxy() in multiTenant.js: it rebuilds
// the path as `/app${rest}`, not just `rest`) - so inside a company container,
// a request originally sent to /app/<slug>/docxtopdf arrives here as plain
// /app/docxtopdf. customRoute's own routes are defined without that prefix
// (POST /docxtopdf), so they only ever matched a bare, non-tenant call.
// Mounting customRoute here too, before Parse claims everything under
// mountPath, is what makes /app/docxtopdf actually reach it instead of being
// swallowed by Parse Server's own router (which has no route for it and was
// answering with a 400 before ever reaching the DOCX/PDF handlers). None of
// customRoute's routes overlap Parse's reserved paths (/functions, /classes,
// /users, /files, ...), and it has no catch-all, so anything it doesn't
// recognize falls through to Parse exactly as before.
app.use(mountPath, customRoute);
app.use(mountPath, defaultServer.app);

// Internal-only endpoint: SuperAdminServer calls this the moment a new
// company finishes provisioning, so its mount goes live immediately
// without restarting this process (and without touching any other
// company's already-running mount). Protected by a shared secret since
// anything reachable on this container's network could otherwise call it.
app.post('/admin/mount-company', express.json(), async (req, res) => {
  if (!internalAdminSecret || req.headers['x-internal-secret'] !== internalAdminSecret) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { slug, databaseName } = req.body || {};
  if (!slug || !databaseName) {
    return res.status(422).json({ error: 'slug and databaseName are both required' });
  }
  try {
    const result = await mountCompany({ slug, databaseName });
    return res.status(200).json(result);
  } catch (err) {
    console.log(`POST /admin/mount-company failed for "${slug}": ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// Internal-only: SuperAdminServer calls this after deleting a company, so
// its mount stops answering requests immediately instead of lingering
// pointed at a now-dropped database until the next restart.
app.post('/admin/unmount-company', express.json(), async (req, res) => {
  if (!internalAdminSecret || req.headers['x-internal-secret'] !== internalAdminSecret) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { slug, purge } = req.body || {};
  if (!slug) return res.status(422).json({ error: 'slug is required' });
  // purge also destroys the company's files volume - deletion only, never a
  // plain unmount, which is meant to be reversible.
  await unmountCompany(slug, { purge: purge === true });
  return res.status(200).json({ unmounted: true, slug, purged: purge === true });
});

app.get('/admin/mounted-companies', (req, res) => {
  if (!internalAdminSecret || req.headers['x-internal-secret'] !== internalAdminSecret) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.status(200).json({ slugs: listMountedSlugs() });
});

// Mount your custom express app
app.use('/', customRoute);

// Parse Server plays nicely with the rest of your web routes
app.get('/', function (req, res) {
  res.status(200).send('opensign-server is running !!!');
});

if (!process.env.TESTING) {
  const port = process.env.PORT || 8081;

  // Start every existing company's container *before* opening the port,
  // so we never answer a request for a company that isn't up yet. New
  // companies come in live via POST /admin/mount-company. Skipped in
  // company mode - a company container must not start other companies.
  if (!isCompanyMode) {
    await loadAllCompaniesAndMount();
  }

  const httpServer = http.createServer(app);
  // Set the Keep-Alive and headers timeout to 100 seconds
  httpServer.keepAliveTimeout = 100000; // in milliseconds
  httpServer.headersTimeout = 100000; // in milliseconds
  httpServer.listen(port, '0.0.0.0', function () {
    console.log('opensign-server running on port ' + port + '.');
  });
}
