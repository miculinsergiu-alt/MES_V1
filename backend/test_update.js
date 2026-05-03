
const db = require('better-sqlite3')('db/smartfactory.db');
try {
  db.prepare('UPDATE purchase_recommendations SET status = \'converted\' WHERE id = 11').run();
  console.log('Success');
} catch (e) {
  console.log('Error:', e.message);
}

