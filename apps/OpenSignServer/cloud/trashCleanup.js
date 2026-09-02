const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // run hourly

// Permanently destroys any contracts_Document that has sat in the trash
// (IsArchive: true) for 30+ days, so trashed files/folders don't linger forever.
async function purgeExpiredTrash() {
  try {
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
    const query = new Parse.Query('contracts_Document');
    query.equalTo('IsArchive', true);
    query.lessThanOrEqualTo('ArchivedAt', cutoff);
    query.limit(1000);
    const expired = await query.find({ useMasterKey: true });
    if (expired.length > 0) {
      await Parse.Object.destroyAll(expired, { useMasterKey: true });
      console.log(`trashCleanup: permanently deleted ${expired.length} expired trash item(s)`);
    }
  } catch (err) {
    console.log('trashCleanup: err purging expired trash', err);
  }
}

export function startTrashCleanupJob() {
  purgeExpiredTrash();
  setInterval(purgeExpiredTrash, CLEANUP_INTERVAL_MS);
}
