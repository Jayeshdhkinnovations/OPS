// Each company has its own database, so nothing stops the same email being
// added as a member of two different companies unless something checks
// across all of them. This checks the SuperAdminDB Company registry (for an
// email already registered as an admin's own company) and every company's
// own contracts_Users collection (for an email added as a plain member),
// using the raw Mongo driver since Parse itself is scoped to one database
// per running process.
import { MongoClient } from 'mongodb';
import { superAdminMongoUri } from '../../Utils.js';

function mongoBase() {
  return String(process.env.MONGODB_URI || '').replace(/\/[^/]+$/, '');
}

async function listCompanies() {
  const client = new MongoClient(superAdminMongoUri);
  try {
    await client.connect();
    return await client.db().collection('Company').find({}).toArray();
  } finally {
    await client.close();
  }
}

// Looks for `email` in every OTHER company (skips `excludeDatabaseName`,
// the caller's own database). Returns null if the email is not found
// anywhere else, otherwise { role: 'admin'|'user', companyName, databaseName, contractsUserId }.
export async function findEmailInOtherCompanies(email, excludeDatabaseName) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  const base = mongoBase();
  const companies = await listCompanies();

  for (const company of companies) {
    const databaseName = company.databaseName;
    if (!databaseName || databaseName === excludeDatabaseName) continue;

    // Cheap check first: the root registry already knows each company's
    // admin email, no second connection needed.
    if (
      String(company.adminEmail || '')
        .trim()
        .toLowerCase() === normalized
    ) {
      return { role: 'admin', companyName: company.companyName || databaseName, databaseName };
    }

    if (!base) continue;
    const client = new MongoClient(`${base}/${databaseName}`);
    try {
      await client.connect();
      const doc = await client
        .db()
        .collection('contracts_Users')
        .findOne({
          Email: {
            $regex: `^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
            $options: 'i',
          },
        });
      if (doc) {
        const role = doc.UserRole === 'contracts_Admin' ? 'admin' : 'user';
        return {
          role,
          companyName: company.companyName || databaseName,
          databaseName,
          contractsUserId: doc._id,
        };
      }
    } catch (err) {
      console.log('crossCompanyEmail: check failed for', databaseName, err?.message || err);
    } finally {
      await client.close();
    }
  }
  return null;
}

// Removes a stale plain-user membership from another company's database so
// that company's own uniqueness isn't violated once this email is granted
// membership elsewhere. Never call this for an 'admin' match.
export async function removeUserFromCompanyDb(databaseName, contractsUserId) {
  const base = mongoBase();
  if (!base || !databaseName || !contractsUserId) return;
  const client = new MongoClient(`${base}/${databaseName}`);
  try {
    await client.connect();
    await client.db().collection('contracts_Users').deleteOne({ _id: contractsUserId });
  } finally {
    await client.close();
  }
}
