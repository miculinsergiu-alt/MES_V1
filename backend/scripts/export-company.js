/**
 * Exports all data of one company as a JSON file.
 * Use for an extra off-site backup, or when a customer asks for their data
 * (GDPR: right to data portability).
 *
 *   node scripts/export-company.js --code ACME [--out acme-2026-11-13.json]
 *
 * Password hashes are never exported.
 */
const { parseArgs } = require('node:util');
const fs = require('node:fs');
const db = require('../db');

const EXCLUDED_COLUMNS = { users: ['password_hash'] };

async function main() {
  const { values } = parseArgs({ options: { code: { type: 'string' }, out: { type: 'string' } } });
  if (!values.code) throw new Error('--code is required');
  await db.initDb();

  const company = await db.withContext({ system: true }, () =>
    db.get('SELECT * FROM companies WHERE code = ?', [values.code.toUpperCase()]));
  if (!company) throw new Error(`Company ${values.code} not found`);

  const data = await db.withContext({ companyId: company.id }, async () => {
    const tables = (await db.all(`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'company_id' ORDER BY table_name`)).map((r) => r.table_name);
    const out = {};
    for (const table of tables) {
      const rows = await db.all(`SELECT * FROM ${table} ORDER BY id`);
      const drop = EXCLUDED_COLUMNS[table] || [];
      out[table] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))));
    }
    return out;
  });

  const file = values.out || `${company.code.toLowerCase()}-export-${new Date().toISOString().slice(0, 10)}.json`;
  const { password_hash, ...companyInfo } = company; // eslint-disable-line no-unused-vars
  fs.writeFileSync(file, JSON.stringify({ exported_at: new Date().toISOString(), company: companyInfo, data }, null, 2));
  const total = Object.values(data).reduce((n, rows) => n + rows.length, 0);
  console.log(`Exported ${total} records of ${company.code} to ${file}`);
  await db.closeDb();
}

main().catch(async (err) => {
  console.error(`Export failed: ${err.message}`);
  await db.closeDb().catch(() => {});
  process.exit(1);
});
