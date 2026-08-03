import { MongoClient } from 'mongodb';

// Polled by the "waiting for approval" page so it can flip to "approved,
// here's your login" without the user needing to refresh manually.
export default async function checkApprovalStatus(request) {
  const { email } = request.params;
  if (!email) throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'email is required.');
  if (!process.env.SUPERADMIN_MONGODB_URI) {
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'SUPERADMIN_MONGODB_URI is not configured.');
  }

  const client = new MongoClient(process.env.SUPERADMIN_MONGODB_URI);
  try {
    await client.connect();
    const db = client.db();

    const company = await db.collection('Company').findOne({ adminEmail: email, status: 'active' });
    if (company) {
      return { status: 'approved', companyName: company.companyName };
    }

    const req = await db.collection('ApprovalRequest').findOne({ email }, { sort: { createdAt: -1 } });
    if (!req) return { status: 'not_found' };
    return { status: req.status }; // 'pending' | 'rejected'
  } finally {
    await client.close();
  }
}
