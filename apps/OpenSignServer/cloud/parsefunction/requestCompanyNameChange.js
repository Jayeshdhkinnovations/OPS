import { MongoClient } from 'mongodb';

function generateParseObjectId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// SERVER_URL is set per-company as `${PUBLIC_ORIGIN}/app/${slug}` (see
// companyEnv() in multiTenant.js) - the last path segment is this
// container's own slug. Nothing else identifies it to itself.
function ownSlug() {
  const url = process.env.SERVER_URL || '';
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

// Runs inside the company's own container. Company name is shown but locked
// in the dashboard - changing it takes a Super Admin's approval rather than
// a direct save, since it's also what routes/identifies the tenant
// platform-wide. This only files the request; nothing changes until
// approveCompanyNameChange (SuperAdminServer) accepts it.
export default async function requestCompanyNameChange(request) {
  const { newName } = request.params;
  if (!newName || !newName.trim()) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'newName is required.');
  }
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'You must be signed in.');
  }
  const slug = ownSlug();
  if (!slug) {
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Could not determine company.');
  }
  if (!process.env.SUPERADMIN_MONGODB_URI) {
    throw new Parse.Error(
      Parse.Error.INTERNAL_SERVER_ERROR,
      'SUPERADMIN_MONGODB_URI is not configured.'
    );
  }

  const client = new MongoClient(process.env.SUPERADMIN_MONGODB_URI);
  try {
    await client.connect();
    const db = client.db();

    const company = await db.collection('Company').findOne({ subdomain: slug });
    if (!company) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Company record not found.');
    }

    const existing = await db
      .collection('CompanyNameChangeRequest')
      .findOne({ subdomain: slug, status: 'pending' });
    if (existing) {
      throw new Parse.Error(
        Parse.Error.DUPLICATE_VALUE,
        'A company name change request is already pending approval.'
      );
    }

    await db.collection('CompanyNameChangeRequest').insertOne({
      _id: generateParseObjectId(),
      subdomain: slug,
      oldName: company.companyName,
      newName: newName.trim(),
      requestedByEmail: request.user.get('email'),
      requestedByName: request.user.get('name') || '',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } finally {
    await client.close();
  }

  return { submitted: true };
}
