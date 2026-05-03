const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'db', 'smartfactory.db'));

console.log('--- CLEANUP START ---');

const result = db.prepare(`
    DELETE FROM orders 
    WHERE planned_start = '' 
    OR planned_end = '' 
    OR planned_start IS NULL
    OR planned_end IS NULL
`).run();

console.log(`Cleaned up ${result.changes} broken orders.`);

// Also clear recommendations for these deleted orders
db.prepare(`
    DELETE FROM purchase_recommendations 
    WHERE triggering_order_id NOT IN (SELECT id FROM orders)
`).run();

console.log('Cleanup finished.');
