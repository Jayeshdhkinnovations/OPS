import { MongoClient } from 'mongodb';
import { verifyGoogleIdToken, deleteFirebaseUser } from '../firebaseAdmin.js';

// Google counterpart to the tenant-scan branch inside loginUser.js. Same
// "which company does this address belong to" scan, but there is no
// password to disambiguate with - the verified Google account id (uid) is
// the disambiguator instead: a company only matches if some _User in it was
// linked to this exact Google account at approval time.
//
// Runs on the root instance, same as the email/password lookup.
export default async function googleLoginLookup(request) {
  const { idToken } = request.params;
  const { firebaseUid, googleId, email, name } = await verifyGoogleIdToken(idToken);

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

    const companies = await db
      .collection('Company')
      .find({ status: 'active' }, { projection: { subdomain: 1, databaseName: 1 } })
      .toArray();

    const candidates = [];
    for (const company of companies) {
      if (!company.databaseName || !company.subdomain) continue;
      const companyDb = client.db(company.databaseName);
      const match = await companyDb
        .collection('_User')
        .findOne({ GoogleUid: googleId }, { projection: { _id: 1, email: 1 } });
      if (!match) continue;
      const isMember = await companyDb
        .collection('contracts_Users')
        .findOne({ Email: match.email || email }, { projection: { _id: 1 } });
      if (isMember) candidates.push(company);
    }

    if (candidates.length >= 1) {
      // Linking the same Google account as a dashboard member of two
      // companies is a real but rare case (same as the email/password
      // duplicate-account situation elsewhere in this app) - there is no
      // extra secret to disambiguate with here the way a password lets the
      // email flow pick, so the first match wins rather than leaving the
      // user stuck.
      console.log(
        `GOOGLE LOGIN LOOKUP: matched uid for "${email}" in ${candidates[0].databaseName}`
      );
      return { status: 'known', subdomain: candidates[0].subdomain };
    }

    // No linked account anywhere - either they've never signed up, or
    // they're mid-approval. Neither case grants any real access, so
    // Firebase's own copy of this sign-in is removed rather than left
    // sitting in the console's user list looking like a usable account -
    // it'll reappear naturally the moment a real, approved sign-in happens.
    deleteFirebaseUser(firebaseUid).catch(() => {});

    const pending = await db.collection('ApprovalRequest').findOne({ email, status: 'pending' });
    if (pending) {
      return { status: 'pending', email, name: pending.name, companyName: pending.companyName };
    }
    return { status: 'new', email, name };
  } finally {
    await client.close();
  }
}
