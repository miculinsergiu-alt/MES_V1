/**
 * Restores an encrypted backup into an EMPTY database.
 *
 *   BACKUP_KEY=<passphrase> DATABASE_URL=<new empty db> node scripts/restore-backup.js --file nova-backup-....bin
 *   BACKUP_KEY=<passphrase> node scripts/restore-backup.js --file ... --check
 *
 * --check restores into a temporary in-memory database and prints the row
 * counts: a restore drill that never touches a real database.
 */
const { parseArgs } = require('node:util');
const fs = require('node:fs');
const db = require('../db');
const { restoreBackup } = require('../lib/backup');

async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string' }, check: { type: 'boolean', default: false } } });
  if (!values.file) throw new Error('--file is required');
  const buf = fs.readFileSync(values.file);
  await db.initDb(values.check ? { memory: true, databaseUrl: null } : {});
  const counts = await restoreBackup(buf, process.env.BACKUP_KEY);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`${values.check ? 'Check OK' : 'Restored'}: ${total} rows in ${Object.keys(counts).length} tables`);
  for (const [t, n] of Object.entries(counts)) if (n) console.log(`  ${t}: ${n}`);
  await db.closeDb();
}

main().catch(async (err) => {
  console.error(`Restore failed: ${err.message}`);
  await db.closeDb().catch(() => {});
  process.exit(1);
});
