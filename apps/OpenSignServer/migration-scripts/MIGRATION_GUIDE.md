# Merging a Company's OpenSign Data — Step by Step Guide

This guide walks through combining a company's separate OpenSign database into
one shared database, while making sure each company's login only ever sees
its own data. No coding knowledge needed — just copy, paste, and follow along.

Total time: about 15 minutes per company.

---

## 1. What This Actually Does (30 seconds)

- You currently have separate OpenSign databases for different companies.
- We are copying all of one company's data (users, documents, folders,
  contacts, templates) into ONE shared database.
- **Nothing is deleted or changed on the original company's side** — it's a
  copy, not a move. Their original system keeps working exactly as before.
- After the copy, each person still only sees their own company's documents
  when they log in — this is built into the app already, we're not adding
  anything new for that part.

---

## 2. What You Need Before Starting

- [ ] **Node.js** installed on your computer (already set up if you're reading
      this from the project folder).
- [ ] **The other company's database address.** This is either:
  - A MongoDB connection string (looks like `mongodb://IP:PORT/dbname`, maybe
    with a username/password), **or**
  - Their app's API address + Application ID + Master Key (if you don't have
    direct database access — ask whoever manages their server for these).
- [ ] **Your own (target) database address** — the one everything gets copied
  into. Usually `mongodb://localhost:PORT/OpenSignDB` or similar.
- [ ] A terminal open in this folder: `apps/OpenSignServer`

---

## 3. Test the Connection First (don't skip this)

Before running anything, just check you can actually reach their database:

```
node -e "require('mongodb').MongoClient.connect(process.argv[1]).then(()=>{console.log('CONNECTED OK');process.exit(0)}).catch(e=>{console.log('FAILED:',e.message);process.exit(1)})" "PASTE_SOURCE_CONNECTION_STRING_HERE"
```

- **"CONNECTED OK"** → good, move to step 4.
- **"FAILED" with `ECONNREFUSED`** → their database isn't reachable from here.
  Common causes: their database is only listening to itself (needs
  `bindIp: 0.0.0.0` on their end), a firewall is blocking the port, or you're
  not on the same network/VPN as their server. You'll need to sort this out
  with whoever manages their server before continuing.

---

## 4. Run the Migration

**If you have direct database access (username/password or open IP):**

```
node migration-scripts/mergeCompanyDb.js "PASTE_SOURCE_CONNECTION_STRING_HERE" "PASTE_YOUR_TARGET_CONNECTION_STRING_HERE"
```

Real example (source = the other company's database, target = our own):
```
node migration-scripts/mergeCompanyDb.js "mongodb://192.168.33.55:27018/OpenSignDB" "mongodb://localhost:27021/OpenSignDB"
```

**If you only have API access (IP + port + Application ID + Master Key, no
database credentials):**

```
node migration-scripts/mergeCompanyDbViaApi.js "PASTE_SOURCE_API_URL_HERE" "PASTE_SOURCE_APP_ID_HERE" "PASTE_SOURCE_MASTER_KEY_HERE" "PASTE_YOUR_TARGET_CONNECTION_STRING_HERE"
```

Real example:
```
node migration-scripts/mergeCompanyDbViaApi.js "http://127.0.0.1:8084/app" "opensign" "XnAadwKxxByMr" "mongodb://localhost:27021/OpenSignDB"
```

> Only 2 values are needed for `mergeCompanyDb.js` (source + target). Any
> extra values pasted after those two are simply ignored by that script — if
> you have API details (URL, App ID, Master Key) as well, those belong to
> the `mergeCompanyDbViaApi.js` command above instead, not mixed into the
> same line as the direct-database command.

> **Note on passwords:** the direct-database version copies real passwords
> over — their users can log in exactly as before. The API-only version
> **cannot** copy passwords (Parse Server blocks that on purpose, even with
> the Master Key) — anyone migrated this way will need to use "Forgot
> Password" once after the merge. This isn't a bug, it's just a limit of
> not having direct database access.

### Reading the result

- **`Migration complete` with a number of records inserted** → success. A
  save file gets created automatically in `migration-scripts/logs/` — **keep
  this file**, it's needed if you ever want to undo this specific merge.
- **`STOPPED - duplicate login email found`** → someone's email already
  exists in both databases. Nothing was written. You need to decide: rename
  one of the two accounts, or skip that person, then run the command again.
- **Any other error** → stop and check the Troubleshooting section below.

---

## 5. Check It Actually Worked

Log into the shared app as someone from the newly merged company and confirm
their documents/folders show up. Then log in as an existing user (someone who
was already there before the merge) and confirm they still only see their
own stuff, not the new company's data.

If someone sees "No data found" even though the migration said it succeeded,
see the Troubleshooting section.

---

## 6. Undoing a Merge (if something's wrong)

Every successful run saves a file in `migration-scripts/logs/` named
something like `merge-1732345678901.json`. To undo that specific merge:

```
node migration-scripts/revertMerge.js "migration-scripts/logs/PASTE_THE_FILE_NAME_HERE.json"
```

Real example:
```
node migration-scripts/revertMerge.js "migration-scripts/logs/merge-1784898097571.json"
```

This deletes exactly what that merge added — nothing more, nothing less. If
you ran the migration more than once, run this once per log file to undo
all of them.

---

## Troubleshooting

**"ECONNREFUSED" error** → Their database isn't reachable from your network.
See Step 3.

**"Migration complete, Records inserted: 0"** → Connected fine, but found
nothing to copy. Almost always means the database *name* in your connection
string is wrong (e.g. you typed `opensign` but their real database is named
`OpenSignDB` or something else). Connect with `mongosh` and run `show dbs`
to see the real name, then try again with the correct one.

**Some collections/tables didn't get copied** → The direct-database script
(`mergeCompanyDb.js`) automatically discovers and copies every collection the
source database actually has, even ones we didn't know about in advance, so
this should not happen with that script. If it still does, or if you're
using the API version (which uses a fixed list), let your technical contact
know which collection was missed so it can be added.

**Data is in the database, but the person sees "No data found" in the app**
→ This means the record's "who owns this" field points to an old/different
ID than what that person's account currently has. Check with:
```
db.contracts_Document.find({}, {Name:1, _acl:1, _p_ExtUserPtr:1, _p_CreatedBy:1})
```
and compare the IDs shown against the person's actual current `_User` and
`contracts_Users` IDs. If they don't match, that record needs its
`_p_CreatedBy` / `_p_ExtUserPtr` / `_acl` fields corrected to the current ID.
This is a deeper fix — get technical help for this one rather than guessing.

---

## Appendix: The Scripts

You shouldn't need to touch these — they already exist in this folder
(`migration-scripts/`). Included here just so this guide is fully
self-contained.

### `mergeCompanyDb.js` (direct database access)

```js
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
```

### `mergeCompanyDbViaApi.js` (API-only access, no direct database credentials)

```js
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
```

### `revertMerge.js` (undo a merge)

```js
// Undoes a merge done by mergeCompanyDb.js or mergeCompanyDbViaApi.js, using the
// manifest file those scripts save after a successful run (migration-scripts/logs/merge-*.json).
// Deletes exactly the records that were inserted - nothing guessed, nothing else touched.
//
// Usage:
//   node revertMerge.js "<path-to-manifest.json>"
//
// Example:
//   node revertMerge.js "migration-scripts/logs/merge-1732345678901.json"

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const [, , manifestPath] = process.argv;

if (!manifestPath) {
  console.error('Usage: node revertMerge.js <path-to-manifest.json>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const { targetUri, report } = manifest;

if (!targetUri || !report?.inserted) {
  console.error('This manifest file is missing targetUri or report.inserted - cannot revert safely.');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(targetUri);
  await client.connect();
  const db = client.db();

  console.log(`This merge ran at: ${manifest.ranAt}`);
  console.log(`It inserted ${report.inserted.length} records into: ${targetUri}`);
  console.log('Deleting all of them now (children first, so nothing dangles mid-revert)...');

  // Reverse order of insertion - documents/contacts/templates before teams/users/org/tenant,
  // and the login accounts last of all.
  const reversed = [...report.inserted].reverse();

  let deleted = 0;
  let missing = 0;
  for (const { collection, id } of reversed) {
    const res = await db.collection(collection).deleteOne({ _id: id });
    if (res.deletedCount > 0) {
      deleted++;
    } else {
      missing++;
      console.log(`(already gone, skipped) ${collection} / ${id}`);
    }
  }

  console.log('\nRevert complete.');
  console.log(`Deleted: ${deleted}`);
  console.log(`Already missing (skipped, not an error): ${missing}`);

  if (report.idCollisions?.length > 0) {
    console.log('\nNote: this merge had ID collisions that were auto-renamed on insert.');
    console.log('Those renamed records are exactly what this script deletes (the new IDs),');
    console.log("so anything that was already in your database before the merge is untouched.");
  }

  await client.close();
}

main().catch((err) => {
  console.error('Revert failed:', err);
  process.exit(1);
});
```
