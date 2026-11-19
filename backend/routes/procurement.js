const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, conflict, badRequest } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const stock = require('../services/stock');
const { nextNumber } = require('../lib/numbering');

const router = express.Router();
router.use(authenticateToken);

const BUYERS = ['administrator', 'planner', 'material_planner', 'warehouse_manager'];

// ─── Purchase recommendations (from MRP) ────────────────────────────────────

router.get('/recommendations', h(async (req, res) => {
  res.json(await db.all(`
    SELECT pr.*, i.name AS item_name, i.item_code, i.uom, o.product_name AS triggering_order_name
    FROM purchase_recommendations pr
    JOIN items i ON pr.item_id = i.id
    LEFT JOIN orders o ON pr.triggering_order_id = o.id
    WHERE pr.status = 'pending'
    ORDER BY pr.created_at DESC, pr.id DESC`));
}));

router.delete('/recommendations/:id', requireRole(...BUYERS), h(async (req, res) => {
  const r = await db.run("DELETE FROM purchase_recommendations WHERE id = ? AND status = 'pending'", [v.paramId(req)]);
  if (!r.rowCount) throw notFound('Open recommendation');
  res.json({ message: 'Recommendation deleted' });
}));

// POST /api/procurement/recommendations/:id/convert — turn a recommendation into a purchase order
router.post('/recommendations/:id/convert', requireRole(...BUYERS), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object({ supplier_id: v.id, expected_date: v.optDate }));

  const rec = await db.get('SELECT * FROM purchase_recommendations WHERE id = ? FOR UPDATE', [id]);
  if (!rec) throw notFound('Recommendation');
  if (rec.status !== 'pending') throw conflict('This recommendation has already been processed');

  // Price: the supplier's agreed price for this item if known, else the item's purchase cost.
  const price = await db.get(`
    SELECT COALESCE(
      (SELECT purchase_price FROM item_suppliers WHERE item_id = ? AND supplier_id = ?),
      (SELECT acquisition_cost FROM items WHERE id = ?)) AS unit_price`, [rec.item_id, b.supplier_id, rec.item_id]);

  const po = await db.get(`
    INSERT INTO purchase_orders (po_number, supplier_id, expected_date, created_by, status)
    VALUES (?, ?, ?, ?, 'ordered') RETURNING id, po_number`,
  [await nextNumber('purchase_order'), b.supplier_id, b.expected_date ?? null, req.user.id]);
  await db.run('INSERT INTO purchase_order_items (po_id, item_id, quantity_ordered, unit_price) VALUES (?, ?, ?, ?)',
    [po.id, rec.item_id, rec.recommended_qty, price?.unit_price ?? 0]);
  await db.run("UPDATE purchase_recommendations SET status = 'converted' WHERE id = ?", [id]);
  res.json({ id: po.id, po_number: po.po_number, message: 'Recommendation converted to purchase order' });
}));

// ─── Purchase orders ────────────────────────────────────────────────────────

router.get('/purchase-orders', h(async (req, res) => {
  res.json(await db.all(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po JOIN suppliers s ON po.supplier_id = s.id
    ORDER BY po.created_at DESC, po.id DESC`));
}));

router.post('/purchase-orders', requireRole(...BUYERS), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    supplier_id: v.id,
    expected_date: v.optDate,
    items: v.z.array(v.z.object({
      item_id: v.id,
      quantity_ordered: v.posNum,
      unit_price: v.nonNeg.default(0),
    })).min(1, 'At least one item is required'),
  }));
  const po = await db.get('INSERT INTO purchase_orders (po_number, supplier_id, expected_date, created_by) VALUES (?, ?, ?, ?) RETURNING id, po_number',
    [await nextNumber('purchase_order'), b.supplier_id, b.expected_date ?? null, req.user.id]);
  for (const item of b.items) {
    await db.run('INSERT INTO purchase_order_items (po_id, item_id, quantity_ordered, unit_price) VALUES (?, ?, ?, ?)',
      [po.id, item.item_id, item.quantity_ordered, item.unit_price]);
  }
  res.json({ id: po.id, po_number: po.po_number });
}));

router.get('/purchase-orders/:id/items', h(async (req, res) => {
  res.json(await db.all(`
    SELECT poi.*, i.name, i.item_code, i.uom
    FROM purchase_order_items poi JOIN items i ON poi.item_id = i.id
    WHERE poi.po_id = ? ORDER BY poi.id`, [v.paramId(req)]));
}));

// ─── Goods receipt ──────────────────────────────────────────────────────────

const receiptSchema = v.z.object({
  po_id: v.optId,
  customer_id: v.optId, // customer-supplied material (Beistellung)
  document_reference: v.optStr(200),
  notes: v.optStr(5000),
  items: v.z.array(v.z.object({
    item_id: v.id,
    lot_number: v.z.string().trim().min(1, 'Lot number is required').max(200),
    quantity_received: v.posNum,
    location_id: v.optId,
    quality_status: v.z.enum(['ok', 'quarantine', 'rejected']).default('ok'),
    expiration_date: v.optDate,
  })).min(1, 'At least one item is required'),
});

// POST /api/procurement/receipts — book incoming goods into stock
router.post('/receipts', requireRole(...BUYERS), h(async (req, res) => {
  const b = v.body(req, receiptSchema);

  if (b.po_id) {
    const po = await db.get('SELECT id, status FROM purchase_orders WHERE id = ? FOR UPDATE', [b.po_id]);
    if (!po) throw notFound('Purchase order');
    if (['received', 'cancelled'].includes(po.status)) throw conflict(`Purchase order is already ${po.status}`);
  }

  if (b.customer_id && b.po_id) throw badRequest('Customer-supplied material is received without a purchase order');
  if (b.customer_id && !(await db.get('SELECT id FROM customers WHERE id = ?', [b.customer_id]))) throw badRequest('Customer not found');
  const receipt = await db.get(`
    INSERT INTO goods_receipts (po_id, customer_id, received_by, document_reference, notes) VALUES (?, ?, ?, ?, ?) RETURNING id`,
  [b.po_id ?? null, b.customer_id ?? null, req.user.id, b.document_reference ?? null, b.notes ?? null]);

  for (const item of b.items) {
    if (b.po_id && !(await db.get('SELECT 1 FROM purchase_order_items WHERE po_id = ? AND item_id = ?', [b.po_id, item.item_id]))) {
      throw badRequest('An item is not on this purchase order. Book it without a purchase order or add it to the order first.');
    }
    const existingLot = await db.get('SELECT id, item_id FROM inventory_lots WHERE lot_number = ?', [item.lot_number]);
    if (existingLot && existingLot.item_id !== item.item_id) {
      throw badRequest(`Lot number ${item.lot_number} is already used for a different item`);
    }

    const receiptItem = await db.get(`
      INSERT INTO goods_receipt_items (receipt_id, item_id, lot_number, quantity_received, location_id, quality_status, expiration_date)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [receipt.id, item.item_id, item.lot_number, item.quantity_received, item.location_id ?? null, item.quality_status, item.expiration_date ?? null]);

    // Rejected goods are documented but not added to stock.
    if (item.quality_status === 'rejected') continue;

    // Purchase price: from the purchase order line, otherwise the item's purchase cost.
    const priceRow = b.po_id
      ? await db.get('SELECT unit_price FROM purchase_order_items WHERE po_id = ? AND item_id = ? ORDER BY id LIMIT 1', [b.po_id, item.item_id])
      : null;
    const unitPrice = b.customer_id ? 0 : priceRow?.unit_price ?? (await db.get('SELECT acquisition_cost FROM items WHERE id = ?', [item.item_id]))?.acquisition_cost ?? 0;
    // Customer material has no value for us and must not change the average cost.
    if (!b.customer_id) await stock.updateAverageCost(item.item_id, item.quantity_received, Number(unitPrice));
    await stock.bookIn({
      itemId: item.item_id, qty: item.quantity_received, lotNumber: item.lot_number, sourceType: 'receipt',
      expirationDate: item.expiration_date ?? null, unitCost: Number(unitPrice),
      referenceType: 'receipt', referenceId: receipt.id, userId: req.user.id, ownerCustomerId: b.customer_id ?? null,
    });

    if (b.po_id) {
      await db.run('UPDATE purchase_order_items SET quantity_received = quantity_received + ? WHERE po_id = ? AND item_id = ?',
        [item.quantity_received, b.po_id, item.item_id]);
    }

    if (item.quality_status === 'quarantine') {
      await db.run(`
        INSERT INTO quarantine_logs (receipt_item_id, item_id, lot_number, quantity, reason, reported_by)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [receiptItem.id, item.item_id, item.lot_number, item.quantity_received, 'Goods receipt: quality issue / quarantine', req.user.id]);
    }
  }

  if (b.po_id) {
    const pending = await db.get(
      'SELECT COUNT(*) AS count FROM purchase_order_items WHERE po_id = ? AND quantity_received < quantity_ordered', [b.po_id]);
    await db.run('UPDATE purchase_orders SET status = ? WHERE id = ?', [pending.count === 0 ? 'received' : 'partial', b.po_id]);
  }
  res.json({ id: receipt.id });
}));

module.exports = router;
