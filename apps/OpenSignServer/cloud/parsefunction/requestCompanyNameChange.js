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

  // Strictly "contracts_Admin" only - same UserRole convention and exact-
  // equality style already used for the delete-account gate in
  // UserProfile.jsx (isAdmin = extendUser?.[0]?.UserRole === "contracts_Admin").
  // contracts_OrgAdmin is a different role and must NOT pass this check, so
  // this cannot be a startsWith/includes/generic "is some kind of admin"
  // test - it has to be the same exact string. Looked up server-side from
  // the authenticated session rather than trusting anything the client
  // could pass in, since request.params is caller-controlled.
  const requesterQuery = new Parse.Query('contracts_Users');
  requesterQuery.equalTo('UserId', {
    __type: 'Pointer',
    className: '_User',
    objectId: request.user.id,
  });
  const requester = await requesterQuery.first({ useMasterKey: true });
  if (!requester || requester.get('UserRole') !== 'contracts_Admin') {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Only Admin users can request a company name change.'
    );
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
