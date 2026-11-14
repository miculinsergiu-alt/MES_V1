const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// GET /api/stock — all stock levels
router.get('/', h(async (req, res) => {
  res.json(await db.all(`
    SELECT sl.*, i.item_code, i.name AS item_name, i.type, i.uom,
      (SELECT string_agg(DISTINCT w.name || ' ' || wl.barcode, ', ')
         FROM inventory_lots il
         JOIN goods_receipt_items gri ON gri.lot_number = il.lot_number AND gri.item_id = il.item_id
         JOIN warehouse_locations wl ON wl.id = gri.location_id
         JOIN warehouses w ON w.id = wl.warehouse_id
        WHERE il.item_id = sl.item_id AND il.quantity > 0) AS lot_locations
    FROM stock_levels sl JOIN items i ON sl.item_id = i.id
    ORDER BY i.item_code ASC`));
}));

// POST /api/stock/adjust — set the counted quantity of an item (inventory correction)
router.post('/adjust', requireRole('planner', 'administrator', 'warehouse_manager'), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    item_id: v.id,
    quantity: v.nonNeg,
    location: v.optStr(200),
    notes: v.optStr(2000),
  }));
  const item = await db.get('SELECT id FROM items WHERE id = ?', [b.item_id]);
  if (!item) throw notFound('Item');

  const existing = await db.get('SELECT quantity FROM stock_levels WHERE item_id = ? FOR UPDATE', [b.item_id]);
  await db.run(`
    INSERT INTO stock_levels (item_id, quantity, location, last_updated) VALUES (?, ?, ?, nova_now())
    ON CONFLICT (item_id) DO UPDATE SET quantity = EXCLUDED.quantity, location = EXCLUDED.location, last_updated = nova_now()`,
  [b.item_id, b.quantity, b.location || null]);

  const diff = b.quantity - (existing?.quantity ?? 0);
  await db.run(`
    INSERT INTO stock_transactions (item_id, quantity, type, reference_type, user_id)
    VALUES (?, ?, 'adjustment', 'manual', ?)`, [b.item_id, diff, req.user.id]);

  res.json({ message: 'Stock adjusted' });
}));

// GET /api/stock/transactions/:item_id
router.get('/transactions/:item_id', h(async (req, res) => {
  res.json(await db.all(`
    SELECT st.*, u.first_name, u.last_name
    FROM stock_transactions st LEFT JOIN users u ON st.user_id = u.id
    WHERE st.item_id = ?
    ORDER BY st.created_at DESC, st.id DESC
    LIMIT 50`, [v.paramId(req, 'item_id')]));
}));

module.exports = router;
