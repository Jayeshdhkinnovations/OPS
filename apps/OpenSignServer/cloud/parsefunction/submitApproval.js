import { MongoClient } from 'mongodb';
import sendSystemMail from './sendSystemMail.js';
import { BRAND_NAME, approvalReceivedEmail } from '../emailTemplates.js';

// Parse's own IDs are short 10-char alphanumeric strings, not MongoDB's
// native 24-char hex ObjectIds. This record gets written here via the raw
// Mongo driver (no company mount exists yet at registration time) but
// later read/updated through Parse Server (approveRequest.js, in
// SuperAdminServer) - so it needs a Parse-shaped _id from the start, or
// Parse.Query(...).get(id) can never find it again (looks like "Object
// not found" even though the record is right there).
function generateParseObjectId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// Called from the registration form on the root instance (bare sign.toowix.com,
// before any company exists yet) - stores a pending request in the control
// plane's own database instead of creating anything real. A Super Admin
// has to approve it (see approveRequest.js in SuperAdminServer) before a
// company/database/login actually gets created.
export default async function submitApproval(request) {
  const { name, email, phone, companyName, jobTitle, password, maxUsers } = request.params;
  if (!name || !email || !companyName || !password) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'name, email, companyName and password are all required.');
  }
  // The registrant picks their own seat count now (the Super Admin only
  // approves/rejects) - clamp to a sane range so a bad/missing value can't
  // produce a company provisioned with 0 or an absurd number of seats.
  const requestedMaxUsers = Math.min(Math.max(parseInt(maxUsers, 10) || 5, 1), 1000);
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
      _id: generateParseObjectId(),
      name,
      email,
      phone: phone || '',
      companyName,
      jobTitle: jobTitle || '',
      password,
      maxUsers: requestedMaxUsers,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } finally {
    await client.close();
  }

  // Acknowledge the submission so the registrant isn't left wondering
  // whether anything happened. Best-effort and not awaited - the request is
  // already stored, and a mail failure must not report it as not submitted.
  const ack = approvalReceivedEmail({ name, companyName });
  sendSystemMail({
    params: {
      from: BRAND_NAME,
      recipient: email,
      subject: ack.subject,
      text: ack.text,
      html: ack.html,
    },
  }).catch(err => console.log('approval-received mail failed:', err?.message || err));

  return { submitted: true };
}
