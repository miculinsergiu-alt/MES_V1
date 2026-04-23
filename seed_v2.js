const { itemsDb, machinesDb } = require('./backend/db/init');

async function seedV2() {
  console.log('🌱 Seeding V2 data...');

  // 1. Requirements
  try {
    itemsDb.prepare('INSERT OR IGNORE INTO requirements (name, description) VALUES (?, ?)').run('Standard', 'Configurație standard');
    itemsDb.prepare('INSERT OR IGNORE INTO requirements (name, description) VALUES (?, ?)').run('Premium', 'Configurație premium cu finisaje extra');
    console.log('✅ Requirements seeded');
  } catch (e) {}

  // 2. Items
  try {
    // Raw Materials
    itemsDb.prepare(`
      INSERT OR IGNORE INTO items (item_code, name, type, uom, acquisition_cost)
      VALUES (?, ?, ?, ?, ?)
    `).run('111111', 'Materie Prima A', 'raw_material', 'kg', 50.5);
    
    itemsDb.prepare(`
      INSERT OR IGNORE INTO items (item_code, name, type, uom, acquisition_cost)
      VALUES (?, ?, ?, ?, ?)
    `).run('222222', 'Materie Prima B', 'raw_material', 'buc', 12.0);

    // Semi-finished
    const semiRes = itemsDb.prepare(`
      INSERT OR IGNORE INTO items (item_code, name, type, uom, production_cost, production_time_min)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('9999999', 'Semifabricat X', 'semi_finished', 'buc', 100, 60);

    const semiId = semiRes.lastInsertRowid || itemsDb.prepare('SELECT id FROM items WHERE item_code = ?').get('9999999').id;

    // Routes for Semi-finished
    itemsDb.prepare('DELETE FROM item_routes WHERE item_id = ?').run(semiId);
    itemsDb.prepare('INSERT INTO item_routes (item_id, machine_id, sequence, process_time_min, notes) VALUES (?, ?, ?, ?, ?)')
      .run(semiId, 1, 1, 60, 'Debitarea principală');

    console.log('✅ Items & Routes seeded');

    // 3. BOM
    const bomRes = itemsDb.prepare('INSERT INTO boms (parent_item_id, name, description) VALUES (?, ?, ?)').run(semiId, 'BOM Semifabricat X', 'Rețeta standard pentru Semifabricat X');
    const bomId = bomRes.lastInsertRowid;

    // Positions
    const item1Id = itemsDb.prepare('SELECT id FROM items WHERE item_code = ?').get('111111').id;
    const item2Id = itemsDb.prepare('SELECT id FROM items WHERE item_code = ?').get('222222').id;

    itemsDb.prepare(`
      INSERT INTO bom_positions (bom_id, item_id, position_code, quantity, start_date, finish_date, location, requirement_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bomId, item1Id, '10/1', 0.1, '2026-01-01', '2026-02-01', 'WH1', 1);

    itemsDb.prepare(`
      INSERT INTO bom_positions (bom_id, item_id, position_code, quantity, start_date, finish_date, location, requirement_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bomId, item2Id, '10/2', 0.5, '2026-02-01', '2026-03-01', 'WH1', null);

    console.log('✅ BOM seeded');
  } catch (e) {
    console.error('Error seeding items/bom:', e.message);
  }

  console.log('✨ Seeding complete!');
}

seedV2();
