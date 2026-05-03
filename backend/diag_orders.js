const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'db', 'smartfactory.db'));

const date_from = '2026-05-03 00:00:00';
const date_to = '2026-05-10 23:59:59';

console.log(`Checking orders between ${date_from} and ${date_to}`);

const orders = db.prepare(`
    SELECT id, product_name, planned_start, planned_end, status 
    FROM orders 
    WHERE status != 'cancelled'
    AND planned_end >= ?
    AND planned_start <= ?
`).all(date_from, date_to);

console.log('Orders found:', orders);

const allOrders = db.prepare('SELECT id, product_name, planned_start, planned_end, status FROM orders').all();
console.log('Total orders in DB:', allOrders);
