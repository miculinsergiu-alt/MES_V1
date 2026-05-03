
const db = require('better-sqlite3')('db/smartfactory.db');
try {
  db.prepare('INSERT INTO purchase_orders (supplier_id, expected_date, created_by, status) VALUES (null, \'2026-05-10\', 2, \'ordered\')').run();
  console.log('Success');
} catch (e) {
  console.log('Error:', e.message);
}

