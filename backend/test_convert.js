
const db = require('better-sqlite3')('db/smartfactory.db');
try {
  db.transaction(() => {
    const poResult = db.prepare('INSERT INTO purchase_orders (supplier_id, expected_date, created_by, status) VALUES (?, ?, ?, \'ordered\')').run(1, '2026-05-10', 2);
    const poId = poResult.lastInsertRowid;
    console.log('PO created with id:', poId);
    
    db.prepare('INSERT INTO purchase_order_items (po_id, item_id, quantity_ordered, unit_price) VALUES (?, ?, ?, (SELECT acquisition_cost FROM items WHERE id = ?))').run(poId, 9, 1500, 9);
    console.log('Item added to PO');
    
    db.prepare('UPDATE purchase_recommendations SET status = \'converted\' WHERE id = ?').run(11);
    console.log('Recommendation updated');
  })();
} catch (e) {
  console.error('ERROR:', e.message);
}

