import { MongoClient } from 'mongodb';
import sendSystemMail from './sendSystemMail.js';
import { BRAND_NAME, approvalReceivedEmail } from '../emailTemplates.js';
import { verifyGoogleIdToken, deleteFirebaseUser } from '../firebaseAdmin.js';

// Same 10-char Parse-shaped id as submitApproval.js - this record is
// written via the raw Mongo driver (no company mount exists yet) but later
// read through Parse Server in approveRequest.js.
function generateParseObjectId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// Google-identity counterpart to submitApproval.js. The one thing that
// actually differs: name/email come from a server-verified Firebase token,
// never from the request body directly - otherwise anyone could submit a
// request claiming to be someone else's email. Everything past that point
// (the pending-request table, the approval flow, the emails) is identical.
export default async function submitApprovalGoogle(request) {
  const { idToken, phone, companyName, jobTitle, maxUsers } = request.params;
  if (!idToken || !companyName) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'idToken and companyName are required.');
  }
  const { firebaseUid, googleId, email, name } = await verifyGoogleIdToken(idToken);

  const requestedMaxUsers = Math.min(Math.max(parseInt(maxUsers, 10) || 5, 1), 1000);
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

    const existing = await db.collection('ApprovalRequest').findOne({ email, status: 'pending' });
    if (existing) {
      throw new Parse.Error(
        Parse.Error.DUPLICATE_VALUE,
        'A request with this email is already pending approval.'
      );
    }
    const existingCompany = await db.collection('Company').findOne({ adminEmail: email });
    if (existingCompany) {
      throw new Parse.Error(
        Parse.Error.DUPLICATE_VALUE,
        'An account with this email already exists - try signing in instead.'
      );
    }

    await db.collection('ApprovalRequest').insertOne({
      _id: generateParseObjectId(),
      name,
      email,
      phone: phone || '',
      companyName,
      jobTitle: jobTitle || '',
      // No password field at all for a Google signup - authProvider marks
      // which branch approveRequest.js/provisionCompany.js should take.
      authProvider: 'google',
      googleUid: googleId,
      maxUsers: requestedMaxUsers,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } finally {
    await client.close();
  }

  // Nobody can sign in with this yet - it's just a pending request - so
  // Firebase's own copy of the sign-in is removed rather than left sitting
  // in the console's user list looking like a real, usable account.
  deleteFirebaseUser(firebaseUid).catch(() => {});

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
