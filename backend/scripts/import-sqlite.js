/**
 * One-time import of an old NOVA SQLite database (smartfactory.db) into
 * PostgreSQL as a new company.
 *
 *   node scripts/import-sqlite.js --file db/smartfactory.db --code ACME --name "Acme GmbH"
 *
 * Uses DATABASE_URL if set, otherwise the local embedded database.
 * - Only runs on a database without users yet (record ids are kept as they are).
 * - Rows that violate the new, stricter rules (e.g. references to deleted
 *   records) are skipped and listed at the end instead of aborting the import.
 * - Old audit logs are not imported (they could contain password hashes).
 * - Users keep their existing passwords.
 */
const { parseArgs } = require('node:util');
const path = require('node:path');
const db = require('../db');
const { nextNumber } = require('../lib/numbering');

// Parents before children, so references can be checked on insert.
const TABLES = [
  'users', 'shifts', 'shift_members', 'areas', 'machines', 'operator_schedules',
  'items', 'item_routes', 'requirements', 'boms', 'bom_positions',
  'suppliers', 'item_suppliers', 'warehouses', 'warehouse_locations',
  'orders', 'delay_reasons', 'order_delays',
  'machine_allocations', 'operator_actions', 'production_results', 'defect_reasons', 'defect_logs',
  'shift_reports', 'report_issues',
  'stock_levels', 'inventory_lots', 'stock_transactions', 'order_material_lots', 'order_material_allocations',
  'purchase_orders', 'purchase_order_items', 'purchase_recommendations',
  'machine_maintenance_config', 'maintenance_logs', 'operator_skills',
  'goods_receipts', 'goods_receipt_items', 'quarantine_logs', 'stock_transfers', 'stock_transfer_items',
];

// Self-referencing tables: insert parents first.
const ORDER_BY = {
  bom_positions: 'COALESCE(level, 1), id',
  orders: 'CASE WHEN parent_order_id IS NULL THEN 0 ELSE 1 END, id',
};

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      code: { type: 'string' },
      name: { type: 'string' },
      timezone: { type: 'string', default: 'Europe/Berlin' },
    },
  });
  if (!values.file || !values.code || !values.name) {
    throw new Error('Usage: node scripts/import-sqlite.js --file <smartfactory.db> --code <COMPANY_CODE> --name "<Company name>"');
  }

  const Database = require('better-sqlite3');
  const sqlite = new Database(path.resolve(values.file), { readonly: true, fileMustExist: true });
  const sqliteTables = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));

  await db.initDb();

  const existingUsers = await db.withContext({ system: true }, () => db.get('SELECT COUNT(*) AS n FROM users'));
  if (existingUsers.n > 0) {
    throw new Error('The target database already contains users. Import only into a fresh database.');
  }

  const company = await db.withContext({ system: true }, () => db.get(
    'INSERT INTO companies (code, name, timezone) VALUES (?, ?, ?) RETURNING *',
    [values.code.trim().toUpperCase(), values.name, values.timezone]));
  console.log(`Created company ${company.code} (id ${company.id}).`);

  const report = [];
  const skipped = [];

  await db.withContext({ companyId: company.id, timezone: company.timezone }, async () => {
    for (const table of TABLES) {
      if (!sqliteTables.has(table)) continue;
      const pgCols = new Set((await db.all(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?", [table],
      )).map((r) => r.column_name));
      const liteCols = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      const cols = liteCols.filter((c) => pgCols.has(c) && c !== 'company_id');
      const rows = sqlite.prepare(`SELECT ${cols.join(', ')} FROM ${table} ORDER BY ${ORDER_BY[table] || 'id'}`).all();

      let imported = 0;
      for (const row of rows) {
        const insertCols = [...cols];
        const values = cols.map((c) => (row[c] === '' && c.endsWith('_id') ? null : row[c]));
        await db.run('SAVEPOINT row_import');
        try {
          // The old database had no purchase order numbers: give each one the next number of its year.
          if (table === 'purchase_orders' && !cols.includes('po_number')) {
            insertCols.push('po_number');
            values.push(await nextNumber('purchase_order', row.order_date));
          }
          const sql = `INSERT INTO ${table} (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`;
          await db.run(sql, values);
          await db.run('RELEASE SAVEPOINT row_import');
          imported += 1;
        } catch (err) {
          await db.run('ROLLBACK TO SAVEPOINT row_import');
          skipped.push(`${table} id=${row.id}: ${err.message}`);
        }
      }
      report.push(`${table}: ${imported}/${rows.length}`);
    }
  });

  // Continue id sequences after the highest imported id (across all companies).
  await db.withContext({ system: true }, async () => {
    for (const table of TABLES) {
      await db.get(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT MAX(id) FROM ${table}), 1))`);
    }
  });

  console.log('\nImported rows:');
  for (const line of report) console.log(`  ${line}`);
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} row(s) that break data rules:`);
    for (const line of skipped) console.log(`  - ${line}`);
  }
  console.log(`\nDone. Users log in with company code "${company.code}" and their existing badge number and password.`);
  sqlite.close();
  await db.closeDb();
}

main().catch(async (err) => {
  console.error(`Import failed: ${err.message}`);
  await db.closeDb().catch(() => {});
  process.exit(1);
});
