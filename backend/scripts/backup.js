/**
 * Encrypted full backup of the whole database (all companies).
 *
 *   BACKUP_KEY=<passphrase> node scripts/backup.js [--out-dir backups] [--keep 30]
 *
 * Writes nova-backup-<timestamp>.bin and deletes backups older than --keep days
 * in the same folder. Keep BACKUP_KEY somewhere safe and separate from the
 * backups: without it the files cannot be read.
 * Restore: scripts/restore-backup.js. Run it daily (Render cron job, Windows
 * task, GitHub Actions schedule) and copy the file to EU storage.
 */
const { parseArgs } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const { createBackup } = require('../lib/backup');

async function main() {
  const { values } = parseArgs({ options: { 'out-dir': { type: 'string', default: 'backups' }, keep: { type: 'string', default: '30' } } });
  const dir = path.resolve(values['out-dir']);
  fs.mkdirSync(dir, { recursive: true });
  await db.initDb();
  const { file, counts } = await createBackup(process.env.BACKUP_KEY);
  const name = `nova-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`;
  fs.writeFileSync(path.join(dir, name), file, { mode: 0o600 });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Backup ${name}: ${total} rows in ${Object.keys(counts).length} tables, ${(file.length / 1024).toFixed(0)} KB`);

  const cutoff = Date.now() - Number(values.keep) * 86400000;
  for (const f of fs.readdirSync(dir)) {
    if (/^nova-backup-.*\.bin$/.test(f) && fs.statSync(path.join(dir, f)).mtimeMs < cutoff) {
      fs.unlinkSync(path.join(dir, f));
      console.log(`Deleted old backup ${f}`);
    }
  }
  await db.closeDb();
}

main().catch(async (err) => {
  console.error(`Backup failed: ${err.message}`);
  await db.closeDb().catch(() => {});
  process.exit(1);
});
