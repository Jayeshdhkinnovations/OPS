import { MongoClient } from 'mongodb';

// The choose_password page's reset link only carries a `token` - this Parse
// Server version (unlike the older one that page's template was written
// against) never includes `username` in the redirect, which is why the page
// showed "Setting a new password for undefined". Resolves the email
// server-side via the same internal field Parse Server itself checks
// (UserController.checkResetTokenValidity), using a direct Mongo read since
// `_`-prefixed internal fields aren't reliably queryable through Parse.Query
// even with the master key.
export default async function resolveResetToken(request) {
  const token = request?.params?.token;
  if (!token || typeof token !== 'string') {
    throw new Parse.Error(Parse.Error.VALIDATION_ERROR, 'A token is required.');
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const user = await client
      .db()
      .collection('_User')
      .findOne(
        { _perishable_token: token },
        { projection: { email: 1, username: 1, _perishable_token_expires_at: 1 } }
      );
    if (!user) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Invalid or expired reset link.');
    }
    const expiresAt = user._perishable_token_expires_at;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Invalid or expired reset link.');
    }
    return { email: user.email || user.username || '' };
  } finally {
    await client.close().catch(() => {});
  }
}
