const Database = require('better-sqlite3');
const db = new Database('smartfactory.db');

const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE sql LIKE '%users_old%' AND name != 'users_old'").all();
console.log('Tables needing fix:');
rows.forEach(r => {
    console.log(`- ${r.name}`);
    const newSql = r.sql.replace(/"users_old"/g, 'users').replace(/users_old/g, 'users');
    console.log(`  New SQL will be: ${newSql.split('\n')[0]}...`);
});

// Perform fixes
db.pragma('foreign_keys = OFF');
const transaction = db.transaction(() => {
    for (const r of rows) {
        const tableName = r.name;
        const tempName = `new_${tableName}`;
        const newSql = r.sql.replace(/"users_old"/g, 'users').replace(/users_old/g, 'users').replace(`CREATE TABLE ${tableName}`, `CREATE TABLE ${tempName}`);
        
        console.log(`Fixing ${tableName}...`);
        db.prepare(newSql).run();
        db.prepare(`INSERT INTO ${tempName} SELECT * FROM ${tableName}`).run();
        db.prepare(`DROP TABLE ${tableName}`).run();
        db.prepare(`ALTER TABLE ${tempName} RENAME TO ${tableName}`).run();
    }
});

try {
    transaction();
    console.log('SUCCESS: All tables updated to reference correct "users" table.');
} catch (e) {
    console.error('FAILED to fix tables:', e);
} finally {
    db.pragma('foreign_keys = ON');
}
