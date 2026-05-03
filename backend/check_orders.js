const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'db', 'smartfactory.db'));

console.log('--- DIAGNOSTIC START ---');

// Check recent orders
const recent = db.prepare('SELECT id, product_name, planned_start, planned_end, status FROM orders ORDER BY id DESC LIMIT 10').all();
console.log('Recent 10 orders:', recent);

// Check if any order is pending and has valid dates
const pending = db.prepare('SELECT id, product_name, status FROM orders WHERE status = "pending"').all();
console.log('Pending orders:', pending);

console.log('--- DIAGNOSTIC END ---');
