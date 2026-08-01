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
