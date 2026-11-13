/**
 * Minimal migration runner.
 *
 * Migrations are plain .sql files in ./migrations, applied in file-name order,
 * each exactly once, each in its own transaction. Never edit a migration that
 * has already been deployed — add a new file instead.
 */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LOCK_ID = 727001; // arbitrary constant for pg_advisory_lock

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
}

async function runMigrations(conn, { log = console.log } = {}) {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Prevent two app instances from migrating at the same time.
  await conn.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  try {
    const { rows } = await conn.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    for (const file of listMigrations()) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await conn.exec('BEGIN');
        await conn.exec(sql);
        await conn.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await conn.exec('COMMIT');
        log(`[migrate] applied ${file}`);
      } catch (err) {
        await conn.exec('ROLLBACK').catch(() => {});
        err.message = `Migration ${file} failed: ${err.message}`;
        throw err;
      }
    }
  } finally {
    await conn.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
  }
}

module.exports = { runMigrations, listMigrations };
