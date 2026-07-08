// Migrate all campaigns from the legacy Twilio pipeline to LiveKit by flipping
// their telephonyProvider to 'livekit'.
//
// Usage (from the server/ directory):
//   node scripts/migrate-campaigns-to-livekit.js --dry-run   # report only, no writes
//   node scripts/migrate-campaigns-to-livekit.js             # perform the migration
//
// GATE: only run the real migration after the Task 20 A/B period shows the
// LiveKit pipeline at >= parity with Twilio (connection rate, duration,
// conversion, cost/call, complaint rate). Always run --dry-run first.
require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set (expected in server/.env). Aborting.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const campaigns = mongoose.connection.collection('campaigns');

  const filter = { telephonyProvider: { $ne: 'livekit' } };
  const legacyCount = await campaigns.countDocuments(filter);
  const total = await campaigns.countDocuments({});
  console.log(`campaigns total=${total} on-legacy=${legacyCount} (telephonyProvider != 'livekit')`);

  if (dryRun) {
    console.log('--dry-run: no changes written.');
  } else if (legacyCount > 0) {
    const res = await campaigns.updateMany(filter, { $set: { telephonyProvider: 'livekit' } });
    console.log(`migrated ${res.modifiedCount} campaign(s) to telephonyProvider='livekit'`);
    const remaining = await campaigns.countDocuments(filter);
    console.log(`verify: ${remaining} campaign(s) still on legacy (should be 0)`);
  } else {
    console.log('nothing to migrate: all campaigns already on livekit.');
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
