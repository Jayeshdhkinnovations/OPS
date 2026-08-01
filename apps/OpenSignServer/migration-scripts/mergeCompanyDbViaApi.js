// Same job as mergeCompanyDb.js, but for when you only have API-level access to the
// source company (IP + port + Application ID + Master Key) instead of direct MongoDB
// credentials - e.g. their database port isn't reachable from outside their network,
// only their OpenSign app's own API is.
//
// Usage:
//   node mergeCompanyDbViaApi.js "<sourceApiUrl>" "<sourceAppId>" "<sourceMasterKey>" "<targetMongoUri>"
//
// Example:
//   node mergeCompanyDbViaApi.js "http://203.0.113.9:8080/app" "opensign" "TheirMasterKey123" "mongodb://localhost:27017/OpenSignDB"

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const [, , sourceApiUrl, sourceAppId, sourceMasterKey, targetUri] = process.argv;

if (!sourceApiUrl || !sourceAppId || !sourceMasterKey || !targetUri) {
  console.error(
    'Usage: node mergeCompanyDbViaApi.js <sourceApiUrl> <sourceAppId> <sourceMasterKey> <targetMongoUri>'
  );
  process.exit(1);
}

const COLLECTIONS_IN_ORDER = [
  '_User',
  'partners_Tenant',
  'contracts_Organizations',
  'contracts_Teams',
  'contracts_Users',
  'contracts_Contactbook',
  'contracts_Template',
  'contracts_Document',
];

const SKIP_COLLECTIONS = new Set(['_Session']);

function generateObjectId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// --- Pulling data over the API instead of a direct DB connection ---

async function fetchPage(className, skip, limit) {
  const path = className === '_User' ? 'users' : `classes/${className}`;
  const url = `${sourceApiUrl}/${path}?limit=${limit}&skip=${skip}&order=createdAt`;
  const res = await fetch(url, {
    headers: {
      'X-Parse-Application-Id': sourceAppId,
      'X-Parse-Master-Key': sourceMasterKey,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API request failed (${res.status}) for ${className}: ${body}`);
  }
  const data = await res.json();
  return data.results;
}

async function fetchAllFromApi(className) {
  const all = [];
  const limit = 500;
  let skip = 0;
  // Parse Server paginates results (default/max limit per request), so keep asking
  // for the next page until a page comes back smaller than what we asked for.
  while (true) {
    const page = await fetchPage(className, skip, limit);
    all.push(...page);
    if (page.length < limit) break;
    skip += limit;
  }
  return all;
}

// The REST API returns a different shape than what's actually stored in Mongo
// (objectId vs _id, ACL vs _acl/_rperm/_wperm, Pointer fields as nested objects
// vs "_p_field: ClassName$id" strings). This converts API JSON back into the same
// raw-storage shape the direct-DB script works with, so the rest of the logic
// (collision checks, pointer remapping, insertion) can stay identical either way.
function restToMongoShape(obj, missingPasswordUsers) {
  const doc = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'objectId') {
      doc._id = value;
    } else if (key === 'createdAt') {
      doc._created_at = new Date(value);
    } else if (key === 'updatedAt') {
      doc._updated_at = new Date(value);
    } else if (key === 'ACL') {
      doc._acl = value;
      doc._rperm = Object.entries(value)
        .filter(([, perms]) => perms.read)
        .map(([id]) => id);
      doc._wperm = Object.entries(value)
        .filter(([, perms]) => perms.write)
        .map(([id]) => id);
    } else if (value && typeof value === 'object' && value.__type === 'Pointer') {
      doc[`_p_${key}`] = `${value.className}$${value.objectId}`;
    } else if (value && typeof value === 'object' && value.__type === 'Date') {
      doc[key] = new Date(value.iso);
    } else {
      doc[key] = value;
    }
  }
  // Parse Server never returns password hashes over the REST API, even with the
  // master key - there is no way around this without direct DB access. Migrated
  // users will need to reset their password after the merge.
  if (obj.className === undefined && missingPasswordUsers) {
    missingPasswordUsers.push({ id: doc._id, username: obj.username });
  }
  return doc;
}

// --- Everything below is the same shape as the direct-DB script ---

function remapPointerString(value, idMaps) {
  const [className, objectId] = value.split('$');
  const newId = idMaps[className]?.get(objectId);
  return newId ? `${className}$${newId}` : value;
}

function remapDocument(doc, idMaps) {
  const result = Array.isArray(doc) ? [] : {};
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith('_p_') && typeof value === 'string') {
      result[key] = remapPointerString(value, idMaps);
    } else if (key === '_acl' && value && typeof value === 'object') {
      const newAcl = {};
      for (const [userId, perms] of Object.entries(value)) {
        newAcl[idMaps['_User']?.get(userId) || userId] = perms;
      }
      result[key] = newAcl;
    } else if ((key === '_rperm' || key === '_wperm') && Array.isArray(value)) {
      result[key] = value.map((entry) => idMaps['_User']?.get(entry) || entry);
    } else if (value && typeof value === 'object' && value.__type === 'Pointer') {
      const newId = idMaps[value.className]?.get(value.objectId);
      result[key] = newId ? { ...value, objectId: newId } : value;
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === 'object' ? remapDocument(item, idMaps) : item
      );
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
      result[key] = remapDocument(value, idMaps);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function migrateCollection(className, targetDb, idMaps, report) {
  if (SKIP_COLLECTIONS.has(className)) return 'OK';

  const apiDocs = await fetchAllFromApi(className);
  if (apiDocs.length === 0) return 'OK';

  const docs = apiDocs.map((obj) =>
    restToMongoShape(obj, className === '_User' ? report.missingPasswordUsers : null)
  );

  const targetCol = targetDb.collection(className);
  idMaps[className] = idMaps[className] || new Map();

  for (const doc of docs) {
    const existingById = await targetCol.findOne({ _id: doc._id });
    if (existingById) {
      const newId = generateObjectId();
      idMaps[className].set(doc._id, newId);
      report.idCollisions.push({ collection: className, oldId: doc._id, newId });
    }
    if (className === '_User') {
      const emailClash = await targetCol.findOne({
        $or: [{ username: doc.username }, { email: doc.email }],
      });
      if (emailClash) {
        report.emailCollisions.push({ oldId: doc._id, username: doc.username });
      }
    }
  }

  if (report.emailCollisions.length > 0 && className === '_User') {
    return 'EMAIL_COLLISION';
  }

  for (const doc of docs) {
    const remapped = remapDocument(doc, idMaps);
    if (idMaps[className].has(doc._id)) {
      remapped._id = idMaps[className].get(doc._id);
    }
    await targetCol.insertOne(remapped);
    report.inserted.push({ collection: className, id: remapped._id });
  }
  return 'OK';
}

async function main() {
  const targetClient = new MongoClient(targetUri);
  await targetClient.connect();
  const targetDb = targetClient.db();

  const idMaps = {};
  const report = { idCollisions: [], emailCollisions: [], inserted: [], missingPasswordUsers: [] };

  try {
    for (const className of COLLECTIONS_IN_ORDER) {
      const status = await migrateCollection(className, targetDb, idMaps, report);
      if (status === 'EMAIL_COLLISION') {
        console.log('STOPPED - duplicate login email found. Nothing was written for _User onward.');
        console.log('Resolve these first (rename one side), then re-run:');
        console.log(report.emailCollisions);
        return;
      }
    }

    console.log('Migration complete.');
    console.log(`Records inserted: ${report.inserted.length}`);
    console.log(`ID collisions fixed: ${report.idCollisions.length}`);
    if (report.idCollisions.length > 0) console.log(report.idCollisions);

    if (report.missingPasswordUsers.length > 0) {
      console.log('\nIMPORTANT: passwords could not be migrated for these users (Parse never');
      console.log('exposes password hashes over the API, even with the master key). They will');
      console.log('need to use "Forgot password" after the merge:');
      console.log(report.missingPasswordUsers);
    }

    // Save exactly what was inserted, so revertMerge.js can undo this precisely
    // later without having to guess which records belong to this migration.
    const logsDir = join(__dirname, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const manifestPath = join(logsDir, `merge-${Date.now()}.json`);
    writeFileSync(
      manifestPath,
      JSON.stringify({ sourceApiUrl, sourceAppId, targetUri, ranAt: new Date().toISOString(), report }, null, 2)
    );
    console.log(`Manifest saved: ${manifestPath}`);
    console.log('Keep this file - it is what revertMerge.js needs to undo this merge.');
  } finally {
    await targetClient.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
