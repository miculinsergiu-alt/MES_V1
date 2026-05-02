const { db } = require('./db/init.js');

try {
    // Clean up previous test data if any
    db.prepare("DELETE FROM items WHERE item_code LIKE '%TEST-01'").run();
    db.prepare("DELETE FROM suppliers WHERE name = 'Test Supplier'").run();

    // 1. Create a Raw Material
    const rm = db.prepare("INSERT INTO items (item_code, name, type, uom) VALUES ('RM-TEST-01', 'Test Raw Material', 'raw_material', 'buc')").run();
    const rmId = rm.lastInsertRowid;

    // 2. Create a Finished Good
    const fg = db.prepare("INSERT INTO items (item_code, name, type, uom) VALUES ('FG-TEST-01', 'Test Finished Good', 'finished_good', 'buc')").run();
    const fgId = fg.lastInsertRowid;

    // 3. Create a BOM: 1 FG needs 2 RM
    const bom = db.prepare("INSERT INTO boms (parent_item_id, name) VALUES (?, 'BOM Test')").run(fgId);
    const bomId = bom.lastInsertRowid;
    db.prepare("INSERT INTO bom_positions (bom_id, item_id, position_code, quantity, node_type) VALUES (?, ?, 'P1', 2, 'component')").run(bomId, rmId);

    // 4. Create a Supplier
    const sup = db.prepare("INSERT INTO suppliers (name) VALUES ('Test Supplier')").run();
    const supId = sup.lastInsertRowid;

    console.log("Setup complete:");
    console.log(JSON.stringify({ rmId, fgId, bomId, supId }, null, 2));
} catch (err) {
    console.error(err);
}
