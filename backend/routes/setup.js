/**
 * Setup wizard support for new companies: sample data and "setup finished".
 */
const express = require('express');
const db = require('../db');
const stock = require('../services/stock');
const { nextNumber } = require('../lib/numbering');
const { h } = require('../lib/handler');
const { conflict } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken, requireRole('administrator'));

// POST /api/setup/sample-data — a small, realistic example factory (only into an empty company)
router.post('/sample-data', h(async (req, res) => {
  const used = await db.get('SELECT (SELECT COUNT(*) FROM items) + (SELECT COUNT(*) FROM machines) + (SELECT COUNT(*) FROM customers) AS n');
  if (used.n > 0) throw conflict('Sample data can only be loaded into an empty company');

  const area = await db.get("INSERT INTO areas (name, description) VALUES ('Fertigung', 'Beispielbereich') RETURNING id");
  const machine = async (name, setup) => (await db.get(
    'INSERT INTO machines (area_id, name, setup_time_min) VALUES (?, ?, ?) RETURNING id', [area.id, name, setup])).id;
  const laser = await machine('Laserschneidanlage', 20);
  const press = await machine('Abkantpresse', 15);
  const assembly = await machine('Montageplatz 1', 5);

  const item = async (code, name, type, extra = {}) => (await db.get(`
    INSERT INTO items (item_code, name, type, uom, acquisition_cost, production_cost, unit_price, production_time_min, tax_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 19) RETURNING id`,
  [code, name, type, extra.uom || 'Stk', extra.cost || 0, extra.prodCost || 0, extra.price || 0, extra.time || 0])).id;
  const sheet = await item('BL-S235-3', 'Stahlblech S235, 3 mm', 'raw_material', { uom: 'kg', cost: 1.35 });
  const screw = await item('SCHR-M8x20', 'Sechskantschraube M8 x 20, verzinkt', 'raw_material', { cost: 0.08 });
  const bracket = await item('WB-100', 'Winkelblech 100 x 50 mm', 'semi_finished', { prodCost: 2.4 });
  const holder = await item('HALT-200', 'Wandhalter HALT-200, montiert', 'finished_good', { prodCost: 6.9, price: 24.9 });

  for (const [itemId, steps] of [[bracket, [[laser, 2], [press, 1]]], [holder, [[assembly, 3]]]]) {
    for (const [i, [machineId, minutes]] of steps.entries()) {
      await db.run('INSERT INTO item_routes (item_id, machine_id, sequence, process_time_min) VALUES (?, ?, ?, ?)', [itemId, machineId, i + 1, minutes]);
    }
  }
  const bom = async (parent, name, lines) => {
    const b = await db.get('INSERT INTO boms (parent_item_id, name) VALUES (?, ?) RETURNING id', [parent, name]);
    for (const [i, [componentId, qty]] of lines.entries()) {
      await db.run(`INSERT INTO bom_positions (bom_id, item_id, position_code, quantity, level, sort_order, node_type)
        VALUES (?, ?, ?, ?, 1, ?, 'component')`, [b.id, componentId, String((i + 1) * 10), qty, i]);
    }
  };
  await bom(bracket, 'Stückliste Winkelblech', [[sheet, 0.35]]);
  await bom(holder, 'Stückliste Wandhalter', [[bracket, 2], [screw, 4]]);

  const wh = await db.get("INSERT INTO warehouses (name, type) VALUES ('Hauptlager', 'central') RETURNING id");
  await db.run("INSERT INTO warehouse_locations (warehouse_id, zone, shelf, bin, barcode) VALUES (?, 'A', '01', '01', 'A-01-01')", [wh.id]);
  const supplier = await db.get(`INSERT INTO suppliers (name, contact_person, email, address, vat_number)
    VALUES ('Beispiel Stahlhandel GmbH', 'Frau Beispiel', 'verkauf@beispiel-stahl.example', 'Hafenstraße 1, 20457 Hamburg', NULL) RETURNING id`);
  await db.run('INSERT INTO item_suppliers (item_id, supplier_id, purchase_price, lead_time_days, is_primary) VALUES (?, ?, 1.35, 5, 1)', [sheet, supplier.id]);

  // Opening stock as a received purchase order, in lots, so batch tracing works from the start.
  const po = await db.get("INSERT INTO purchase_orders (po_number, supplier_id, created_by, status) VALUES (?, ?, ?, 'received') RETURNING id",
    [await nextNumber('purchase_order'), supplier.id, req.user.id]);
  const receipt = await db.get("INSERT INTO goods_receipts (po_id, received_by, document_reference) VALUES (?, ?, 'LS-BEISPIEL-1') RETURNING id", [po.id, req.user.id]);
  for (const [itemId, qty, price, lot] of [[sheet, 500, 1.35, 'CH-BLECH-001'], [screw, 2000, 0.04, 'CH-SCHR-001']]) {
    await db.run('INSERT INTO purchase_order_items (po_id, item_id, quantity_ordered, quantity_received, unit_price) VALUES (?, ?, ?, ?, ?)', [po.id, itemId, qty, qty, price]);
    await db.run('INSERT INTO goods_receipt_items (receipt_id, item_id, lot_number, quantity_received) VALUES (?, ?, ?, ?)', [receipt.id, itemId, lot, qty]);
    await stock.updateAverageCost(itemId, qty, price);
    await stock.bookIn({ itemId, qty, lotNumber: lot, sourceType: 'receipt', unitCost: price, referenceType: 'receipt', referenceId: receipt.id, userId: req.user.id });
  }
  await stock.bookIn({ itemId: holder, qty: 25, lotNumber: 'ANFANG-HALT-200', sourceType: 'adjustment', referenceType: 'adjustment', userId: req.user.id });
  await db.run("UPDATE stock_levels SET location = 'A-01-01' WHERE item_id IN (?, ?, ?)", [sheet, screw, holder]);
  await db.run(`INSERT INTO customers (customer_number, name, street, postal_code, city, country, email, tax_treatment, datev_account)
    VALUES ('10001', 'Beispiel Maschinenbau GmbH', 'Musterstraße 12', '70173', 'Stuttgart', 'DE', 'einkauf@beispiel-maschinenbau.example', 'domestic', 10001)`);
  await db.run("UPDATE number_series SET next_number = GREATEST(next_number, 10002) WHERE doc_type = 'customer'");
  await db.run(`INSERT INTO number_series (doc_type, prefix, yearly_reset, digits, next_number) VALUES ('customer', '', 0, 5, 10002)
    ON CONFLICT (company_id, doc_type) DO NOTHING`);

  res.status(201).json({ message: 'Sample data loaded', machines: 3, items: 4, customers: 1, suppliers: 1 });
}));

// POST /api/setup/complete — finish the setup wizard
router.post('/complete', h(async (req, res) => {
  await db.run('UPDATE companies SET onboarding_completed = 1 WHERE id = ?', [req.user.company_id]);
  res.json({ onboarding_completed: 1 });
}));

module.exports = router;
