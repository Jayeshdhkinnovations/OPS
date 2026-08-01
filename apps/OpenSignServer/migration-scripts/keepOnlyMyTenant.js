// Finds your own Tenant (by your login email) and deletes every OTHER tenant's data -
// users, orgs, teams, documents, contacts, templates, logins. Your own tenant is
// never touched. Useful to undo a merge when there's no manifest file to revert from.
//
// Safe by default: without --confirm, it only PRINTS what it would delete.
// Nothing is removed until you re-run the same command with --confirm added.
//
// Usage:
//   node keepOnlyMyTenant.js "<targetMongoUri>" "<your-email>"            (dry run - shows what would be deleted)
//   node keepOnlyMyTenant.js "<targetMongoUri>" "<your-email>" --confirm  (actually deletes)
//
// Example:
//   node keepOnlyMyTenant.js "mongodb://localhost:27018/OpenSignDB" "jayesh@dhkinnovations.com" --confirm

import { MongoClient } from 'mongodb';

const [, , targetUri, myEmail, flag] = process.argv;
const confirmed = flag === '--confirm';

if (!targetUri || !myEmail) {
  console.error('Usage: node keepOnlyMyTenant.js <targetMongoUri> <your-email> [--confirm]');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(targetUri);
  await client.connect();
  const db = client.db();

  // 1. Find your own user account, then your profile, then your Tenant.
  const myUser = await db.collection('_User').findOne({
    $or: [{ username: myEmail }, { email: myEmail }],
  });
  if (!myUser) {
    console.error(`No user found with email/username "${myEmail}". Nothing done.`);
    return;
  }

  const myProfile = await db.collection('contracts_Users').findOne({
    _p_UserId: `_User$${myUser._id}`,
  });
  if (!myProfile || !myProfile._p_TenantId) {
    console.error('Could not find your Tenant (your profile or TenantId is missing). Nothing done.');
    return;
  }

  const myTenantId = myProfile._p_TenantId.split('$')[1];
  const myTenant = await db.collection('partners_Tenant').findOne({ _id: myTenantId });
  console.log(`Your tenant: "${myTenant?.TenantName}" (${myTenantId}) - this will be KEPT.`);

  // 2. Find every OTHER tenant - everything tied to these gets deleted.
  const otherTenants = await db.collection('partners_Tenant').find({ _id: { $ne: myTenantId } }).toArray();
  if (otherTenants.length === 0) {
    console.log('No other tenants found - your database already only has your own data. Nothing to do.');
    return;
  }

  console.log(`\nFound ${otherTenants.length} other tenant(s) that will be REMOVED:`);
  otherTenants.forEach((t) => console.log(`  - "${t.TenantName}" (${t._id})`));

  const plan = [];
  for (const tenant of otherTenants) {
    const tenantPtr = `partners_Tenant$${tenant._id}`;
    const orgs = await db.collection('contracts_Organizations').find({ _p_TenantId: tenantPtr }).toArray();
    const orgIds = orgs.map((o) => o._id);
    const profiles = await db.collection('contracts_Users').find({ _p_TenantId: tenantPtr }).toArray();
    const profileIds = profiles.map((p) => p._id);
    const realUserIds = profiles
      .map((p) => p._p_UserId?.split('$')[1])
      .filter(Boolean);
    const profilePointers = profileIds.map((id) => `contracts_Users$${id}`);

    plan.push({ tenant, orgIds, profileIds, realUserIds, profilePointers });
  }

  const totalDocs = async () => {
    let n = 0;
    for (const p of plan) {
      n += await db.collection('contracts_Document').countDocuments({ _p_ExtUserPtr: { $in: p.profilePointers } });
      n += await db.collection('contracts_Contactbook').countDocuments({ _p_ExtUserPtr: { $in: p.profilePointers } });
      n += await db.collection('contracts_Template').countDocuments({ _p_ExtUserPtr: { $in: p.profilePointers } });
    }
    return n;
  };
  const docCount = await totalDocs();
  const userCount = plan.reduce((n, p) => n + p.realUserIds.length, 0);

  console.log(`\nThis will delete: ${otherTenants.length} tenant(s), ${userCount} login(s), and ${docCount} document/contact/template record(s).`);

  if (!confirmed) {
    console.log('\nDRY RUN ONLY - nothing was deleted. Re-run with --confirm at the end to actually do it.');
    await client.close();
    return;
  }

  console.log('\n--confirm given - deleting now...');
  for (const { tenant, orgIds, profileIds, realUserIds, profilePointers } of plan) {
    await db.collection('contracts_Document').deleteMany({ _p_ExtUserPtr: { $in: profilePointers } });
    await db.collection('contracts_Contactbook').deleteMany({ _p_ExtUserPtr: { $in: profilePointers } });
    await db.collection('contracts_Template').deleteMany({ _p_ExtUserPtr: { $in: profilePointers } });
    await db.collection('contracts_Teams').deleteMany({
      _p_OrganizationId: { $in: orgIds.map((id) => `contracts_Organizations$${id}`) },
    });
    await db.collection('contracts_Users').deleteMany({ _id: { $in: profileIds } });
    await db.collection('contracts_Organizations').deleteMany({ _id: { $in: orgIds } });
    await db.collection('partners_Tenant').deleteOne({ _id: tenant._id });
    await db.collection('_User').deleteMany({ _id: { $in: realUserIds } });
    console.log(`Removed tenant "${tenant.TenantName}" and everything tied to it.`);
  }

  console.log('\nDone. Your database now only contains your own tenant\'s data.');
  await client.close();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
