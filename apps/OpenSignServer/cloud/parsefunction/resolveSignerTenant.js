import { MongoClient } from 'mongodb';

// Signing links are emailed as `<origin>/login/<base64>` with no company in
// the path, so a signer arriving cold lands on the root instance - whose
// database holds no documents at all. Every call the guest page then made
// (linkcontacttodoc, getDocument, the OTP lookup) missed, which is why the
// document never opened and the verification code never matched.
//
// This runs on the root instance and answers "which company owns this
// document?" so the guest page can point itself at the right mount before
// doing anything else. Keeping the link format unchanged means links that
// were already emailed keep working.
//
// Unauthenticated by necessity - the caller is an external signer with no
// account. It is safe: the caller must already possess an exact 10-character
// Parse objectId, and the only thing returned is a company slug that is
// visible in the URL afterwards anyway. No document contents are exposed.
export default async function resolveSignerTenant(request) {
  const { docId } = request.params;
  if (!docId || typeof docId !== 'string' || !/^[A-Za-z0-9]{6,20}$/.test(docId)) {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A valid docId is required.');
  }

  const superAdminUri = process.env.SUPERADMIN_MONGODB_URI;
  if (!superAdminUri) {
    throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'SUPERADMIN_MONGODB_URI is not configured.');
  }

  const client = new MongoClient(superAdminUri);
  try {
    await client.connect();
    const companies = await client
      .db()
      .collection('Company')
      .find({ status: 'active' })
      .project({ subdomain: 1, databaseName: 1 })
      .toArray();

    // Companies live in separate databases on the same server, so the search
    // is a cheap _id lookup per database rather than a scan.
    for (const company of companies) {
      if (!company.databaseName || !company.subdomain) continue;
      const db = client.db(company.databaseName);
      const found = await db.collection('contracts_Document').findOne({ _id: docId }, { projection: { _id: 1 } });
      if (found) {
        return { subdomain: company.subdomain };
      }
    }
  } finally {
    await client.close();
  }

  // Deliberately not an error: an unknown id is indistinguishable from a
  // deleted document, and the guest page falls back to the root mount.
  return { subdomain: null };
}
