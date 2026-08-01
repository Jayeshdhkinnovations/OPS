// Merges one company's OpenSign MongoDB into another (the shared/target database),
// without touching the app's schema or logic - a straight data copy plus safety checks.
//
// Usage:
//   node mergeCompanyDb.js "<sourceMongoUri>" "<targetMongoUri>"
//
// Example (Company A test -> main db):
//   node mergeCompanyDb.js "mongodb://localhost:27101/CompanyA_DB" "mongodb://localhost:27017/OpenSignDB"

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const [, , sourceUri, targetUri] = process.argv;

if (!sourceUri || !targetUri) {
  console.error('Usage: node mergeCompanyDb.js <sourceMongoUri> <targetMongoUri>');
  process.exit(1);
}

// Known classes go first, in dependency order, so any pointer in a later collection
// can already find its target after insertion. Anything else the source database
// actually has (custom classes, OTP tables, etc.) gets appended after these
// automatically in main() - so nothing gets silently skipped just because it
// wasn't on this list in advance.
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

// Never migrated: login sessions (everyone just logs in again after the merge),
// and Parse/Mongo's own internal bookkeeping collections (not real app data).
const SKIP_COLLECTIONS = new Set([
  '_Session',
  '_SCHEMA',
  '_Hooks',
  '_GlobalConfig',
  '_Audience',
  '_PushStatus',
  '_JobStatus',
  '_JobSchedule',
  '_Idempotency',
]);

function generateObjectId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// Parse's Mongo layer stores a single Pointer field as `_p_<field>: "ClassName$objectId"`,
// but a Pointer sitting inside an Array or the ACL uses the plain {__type:'Pointer',...} JSON
// shape instead. Both need their objectId rewritten if that target record's ID collided.
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

async function migrateCollection(sourceDb, targetDb, collectionName, idMaps, report) {
  if (SKIP_COLLECTIONS.has(collectionName)) return 'OK';

  const sourceCol = sourceDb.collection(collectionName);
  const targetCol = targetDb.collection(collectionName);
  const docs = await sourceCol.find({}).toArray();
  if (docs.length === 0) return 'OK';

  idMaps[collectionName] = idMaps[collectionName] || new Map();

  // Pass 1: find ID clashes and duplicate login emails before writing anything.
  for (const doc of docs) {
    const existingById = await targetCol.findOne({ _id: doc._id });
    if (existingById) {
      const newId = generateObjectId();
      idMaps[collectionName].set(doc._id, newId);
      report.idCollisions.push({ collection: collectionName, oldId: doc._id, newId });
    }
    if (collectionName === '_User') {
      // Deliberately not excluding doc._id here: if this record's ID is being remapped
      // above due to a clash, the *old* record still holds this username in the target,
      // so a same-id match is a real duplicate too (e.g. this company was already merged
      // once before) and must stop the run just like a cross-company email clash would.
      const emailClash = await targetCol.findOne({
        $or: [{ username: doc.username }, { email: doc.email }],
      });
      if (emailClash) {
        report.emailCollisions.push({ oldId: doc._id, username: doc.username });
      }
    }
  }

  // A duplicate login email needs a human decision (rename which one?) - stop here
  // rather than guessing, so nothing gets written with an ambiguous identity.
  if (report.emailCollisions.length > 0 && collectionName === '_User') {
    return 'EMAIL_COLLISION';
  }

  // Pass 2: rewrite pointers/ACLs using the ID map, then insert.
  for (const doc of docs) {
    const remapped = remapDocument(doc, idMaps);
    if (idMaps[collectionName].has(doc._id)) {
      remapped._id = idMaps[collectionName].get(doc._id);
    }
    await targetCol.insertOne(remapped);
    report.inserted.push({ collection: collectionName, id: remapped._id });
  }
  return 'OK';
}

async function main() {
  const sourceClient = new MongoClient(sourceUri);
  const targetClient = new MongoClient(targetUri);
  await sourceClient.connect();
  await targetClient.connect();

  const sourceDb = sourceClient.db();
  const targetDb = targetClient.db();

  // Discover every collection the source actually has, so custom/extra ones
  // (not on our known list) still get migrated instead of silently skipped.
  const actualCollections = (await sourceDb.listCollections().toArray()).map((c) => c.name);
  const extraCollections = actualCollections.filter(
    (name) => !COLLECTIONS_IN_ORDER.includes(name) && !SKIP_COLLECTIONS.has(name)
  );
  if (extraCollections.length > 0) {
    console.log('Found extra collections not on the known list, migrating those too:');
    console.log(extraCollections);
  }
  const allCollectionsInOrder = [...COLLECTIONS_IN_ORDER, ...extraCollections];

  const idMaps = {};
  const report = { idCollisions: [], emailCollisions: [], inserted: [] };

  try {
    for (const collectionName of allCollectionsInOrder) {
      const status = await migrateCollection(sourceDb, targetDb, collectionName, idMaps, report);
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
    if (report.idCollisions.length > 0) {
      console.log(report.idCollisions);
    }

    // Save exactly what was inserted, so revertMerge.js can undo this precisely
    // later without having to guess which records belong to this migration.
    const logsDir = join(__dirname, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const manifestPath = join(logsDir, `merge-${Date.now()}.json`);
    writeFileSync(
      manifestPath,
      JSON.stringify({ sourceUri, targetUri, ranAt: new Date().toISOString(), report }, null, 2)
    );
    console.log(`Manifest saved: ${manifestPath}`);
    console.log('Keep this file - it is what revertMerge.js needs to undo this merge.');
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
