const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'db', 'smartfactory.db'));

console.log('--- DIAGNOSTIC START ---');

// 1. Check Items
const items = db.prepare('SELECT id, item_code, name, type FROM items').all();
console.log('\n[1] ALL ITEMS:', items);

// 2. Check BOMs
const boms = db.prepare('SELECT id, parent_item_id, name FROM boms').all();
console.log('\n[2] ALL BOMs:', boms);

// 3. Check BOM Positions for the last created BOM
if (boms.length > 0) {
    const lastBom = boms[boms.length - 1];
    const positions = db.prepare('SELECT * FROM bom_positions WHERE bom_id = ?').all(lastBom.id);
    console.log(`\n[3] POSITIONS FOR BOM #${lastBom.id} (${lastBom.name}):`, positions);
}

// 4. Check Orders
const orders = db.prepare('SELECT id, product_name, item_id, bom_id, quantity, status FROM orders ORDER BY id DESC LIMIT 5').all();
console.log('\n[4] RECENT ORDERS:', orders);

// 5. Check Recommendations
const recs = db.prepare('SELECT * FROM purchase_recommendations').all();
console.log('\n[5] ALL PURCHASE RECOMMENDATIONS:', recs);

// 6. Check Stock Levels
const stock = db.prepare('SELECT * FROM stock_levels').all();
console.log('\n[6] STOCK LEVELS:', stock);

console.log('\n--- DIAGNOSTIC END ---');
