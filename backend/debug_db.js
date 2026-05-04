const { db } = require('./db/init');

console.log('--- USERS ---');
const users = db.prepare('SELECT id, first_name, role FROM users').all();
console.table(users);

console.log('\n--- SUPPLIERS ---');
const suppliers = db.prepare('SELECT id, name FROM suppliers').all();
console.table(suppliers);

console.log('\n--- PENDING RECOMMENDATIONS ---');
const recs = db.prepare(`
  SELECT pr.id, pr.item_id, pr.status, i.item_code 
  FROM purchase_recommendations pr
  LEFT JOIN items i ON pr.item_id = i.id
  WHERE pr.status = 'pending'
`).all();
console.table(recs);

console.log('\n--- FK VALIDATION CHECK ---');
recs.forEach(r => {
    const itemExists = db.prepare('SELECT id FROM items WHERE id = ?').get(r.item_id);
    if (!itemExists) {
        console.error(`!!! Recommendation ${r.id} points to non-existent item_id ${r.item_id}`);
    }
});

const orphanedPOItems = db.prepare(`
    SELECT poi.id, poi.po_id, poi.item_id 
    FROM purchase_order_items poi
    LEFT JOIN purchase_orders po ON poi.po_id = po.id
    WHERE po.id IS NULL
`).all();
if (orphanedPOItems.length > 0) {
    console.error('!!! Found purchase_order_items without purchase_orders:');
    console.table(orphanedPOItems);
}
