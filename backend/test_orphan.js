
const db = require('better-sqlite3')('db/smartfactory.db');
try {
  db.pragma('foreign_keys = ON');
  
  // Create an order
  const orderId = db.prepare('INSERT INTO orders (machine_id, product_name, quantity, planned_start, planned_end) VALUES (7, \'Test\', 1, \'2026-05-01\', \'2026-05-02\')').run().lastInsertRowid;
  
  // Create a recommendation
  const recId = db.prepare('INSERT INTO purchase_recommendations (item_id, recommended_qty, triggering_order_id) VALUES (9, 10, ?)').run(orderId).lastInsertRowid;
  
  // Delete the order (but wait, can we delete it?)
  // If we delete the order, SQLite will BLOCK the deletion because purchase_recommendations points to it!
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  
} catch (e) {
  console.log('Error:', e.message);
}

