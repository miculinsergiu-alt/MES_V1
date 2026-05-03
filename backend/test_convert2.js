
const db = require('better-sqlite3')('db/smartfactory.db');
try {
  db.transaction(() => {
    const poResult = db.prepare('INSERT INTO purchase_orders (supplier_id, expected_date, created_by, status) VALUES (?, ?, ?, \'ordered\')').run('1', '2026-05-10', 2);
    const poId = poResult.lastInsertRowid;
    console.log('PO created with id:', poId);
  })();
} catch (e) {
  console.error('ERROR:', e.message);
}

