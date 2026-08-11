require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('./db');

// pending_registrations is already created in migrate.js's TABLES array; this
// script exists as a separate step (per the two-stage npm start script) for any
// future auth-only schema changes, kept idempotent and safe to re-run.
async function migrateAuth() {
  console.log('[migrate_auth] verifying auth tables…');
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'pending_registrations'`,
    [process.env.DB_NAME]
  );
  if (rows[0].cnt === 0) {
    throw new Error('pending_registrations table missing — run `npm run migrate` (config/migrate.js) first');
  }
  console.log('[migrate_auth] OK.');
}

if (require.main === module) {
  migrateAuth()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[migrate_auth] failed:', err);
      process.exit(1);
    });
}

module.exports = { migrateAuth };
