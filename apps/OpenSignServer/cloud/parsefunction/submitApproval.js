import { MongoClient } from 'mongodb';

// Called from the registration form on the root instance (bare sign.toowix.com,
// before any company exists yet) - stores a pending request in the control
// plane's own database instead of creating anything real. A Super Admin
// has to approve it (see approveRequest.js in SuperAdminServer) before a
// company/database/login actually gets created.
export default async function submitApproval(request) {
  const { name, email, phone, companyName, jobTitle, password } = request.params;
  if (!name || !email || !companyName || !password) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'name, email, companyName and password are all required.');
  }
  if (!process.env.SUPERADMIN_MONGODB_URI) {
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'SUPERADMIN_MONGODB_URI is not configured.');
  }

  const client = new MongoClient(process.env.SUPERADMIN_MONGODB_URI);
  try {
    await client.connect();
    const db = client.db();

    const existing = await db.collection('ApprovalRequest').findOne({ email, status: 'pending' });
    if (existing) {
      throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'A request with this email is already pending approval.');
    }
    const existingCompany = await db.collection('Company').findOne({ adminEmail: email });
    if (existingCompany) {
      throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'An account with this email already exists - try logging in instead.');
    }

    // NOTE: password is stored as plain text here, temporarily, until a
    // Super Admin approves the request - at which point it's used once to
    // create the real _User and then immediately deleted from this record
    // (see approveRequest.js). This is a deliberate, narrow exception,
    // not a general pattern - real passwords are never stored anywhere
    // else in the system.
    await db.collection('ApprovalRequest').insertOne({
      name,
      email,
      phone: phone || '',
      companyName,
      jobTitle: jobTitle || '',
      password,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } finally {
    await client.close();
  }

  return { submitted: true };
}
