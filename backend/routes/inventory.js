const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// POST /api/inventory/transfers — move lots between warehouses/locations
router.post('/transfers', requireRole('administrator', 'warehouse_manager', 'material_planner', 'planner'), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    from_warehouse_id: v.optId,
    to_warehouse_id: v.optId,
    items: v.z.array(v.z.object({
      item_id: v.id,
      lot_number: v.optStr(200),
      quantity: v.posNum,
      from_location_id: v.optId,
      to_location_id: v.optId,
    })).min(1, 'At least one item is required'),
  }));

  const transfer = await db.get(`
    INSERT INTO stock_transfers (from_warehouse_id, to_warehouse_id, created_by, completed_at)
    VALUES (?, ?, ?, nova_now()) RETURNING id`,
  [b.from_warehouse_id ?? null, b.to_warehouse_id ?? null, req.user.id]);

  for (const item of b.items) {
    if (item.from_location_id && item.from_location_id === item.to_location_id) {
      throw badRequest('Source and target location are the same');
    }
    let lotId = null;
    if (!item.lot_number) {
      const level = await db.get('SELECT quantity FROM stock_levels WHERE item_id = ?', [item.item_id]);
      if (!level || Number(level.quantity) < item.quantity) throw badRequest(`Only ${Number(level?.quantity ?? 0)} in stock`);
    }
    if (item.lot_number) {
      const lot = await db.get('SELECT id, item_id, quantity FROM inventory_lots WHERE lot_number = ?', [item.lot_number]);
      if (!lot) throw badRequest(`Lot ${item.lot_number} not found`);
      if (lot.item_id !== item.item_id) throw badRequest(`Lot ${item.lot_number} belongs to a different item`);
      if (lot.quantity < item.quantity) throw badRequest(`Lot ${item.lot_number} has only ${lot.quantity} in stock`);
      if (item.from_location_id) {
        const where = await db.all('SELECT DISTINCT location_id FROM goods_receipt_items WHERE lot_number = ? AND item_id = ? AND location_id IS NOT NULL',
          [item.lot_number, item.item_id]);
        if (where.length && !where.some((w) => w.location_id === item.from_location_id)) {
          throw badRequest(`Lot ${item.lot_number} is not stored at the source location`);
        }
      }
      lotId = lot.id;
    }

    await db.run(`
      INSERT INTO stock_transfer_items (transfer_id, item_id, lot_number, quantity, from_location_id, to_location_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [transfer.id, item.item_id, item.lot_number ?? null, item.quantity, item.from_location_id ?? null, item.to_location_id ?? null]);

    // Total stock is unchanged; both movements are logged for traceability.
    for (const [qty, ref] of [[-item.quantity, 'transfer_out'], [item.quantity, 'transfer_in']]) {
      await db.run(`
        INSERT INTO stock_transactions (item_id, lot_id, quantity, type, reference_type, reference_id, user_id)
        VALUES (?, ?, ?, 'adjustment', ?, ?, ?)`,
      [item.item_id, lotId, qty, ref, transfer.id, req.user.id]);
    }

    if (item.to_location_id && item.lot_number) {
      await db.run('UPDATE goods_receipt_items SET location_id = ? WHERE lot_number = ? AND item_id = ?',
        [item.to_location_id, item.lot_number, item.item_id]);
    }
  }
  res.json({ id: transfer.id });
}));

// GET /api/inventory/traceability/:lotNumber
router.get('/traceability/:lotNumber', h(async (req, res) => {
  const { lotNumber } = v.params(req, v.z.object({ lotNumber: v.z.string().min(1).max(200) }));
  const lot = await db.get(`
    SELECT il.*, i.name AS item_name, i.item_code, i.uom
    FROM inventory_lots il JOIN items i ON il.item_id = i.id
    WHERE il.lot_number = ?`, [lotNumber]);
  if (!lot) throw notFound('Lot');
  const transactions = await db.all(`
    SELECT st.*, u.first_name || ' ' || u.last_name AS user_name
    FROM stock_transactions st LEFT JOIN users u ON st.user_id = u.id
    WHERE st.lot_id = ?
    ORDER BY st.created_at ASC, st.id ASC`, [lot.id]);
  res.json({ lot, transactions });
}));

module.exports = router;
