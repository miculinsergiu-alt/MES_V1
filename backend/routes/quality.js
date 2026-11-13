const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, conflict } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const QUALITY_ROLES = ['administrator', 'warehouse_manager', 'material_planner', 'area_supervisor', 'planner'];

// GET /api/quality/quarantine — open quarantine cases
router.get('/quarantine', h(async (req, res) => {
  res.json(await db.all(`
    SELECT ql.*, i.name AS item_name, i.item_code, i.uom, u.first_name || ' ' || u.last_name AS reporter_name
    FROM quarantine_logs ql
    JOIN items i ON ql.item_id = i.id
    JOIN users u ON ql.reported_by = u.id
    WHERE ql.status = 'pending'
    ORDER BY ql.created_at DESC`));
}));

// PUT /api/quality/quarantine/:id/resolve — release or scrap a quarantined lot
router.put('/quarantine/:id/resolve', requireRole(...QUALITY_ROLES), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object({
    decision: v.z.enum(['released', 'scrapped']),
    notes: v.optStr(2000),
  }));

  const log = await db.get('SELECT * FROM quarantine_logs WHERE id = ? FOR UPDATE', [id]);
  if (!log) throw notFound('Quarantine case');
  if (log.status !== 'pending') throw conflict('This quarantine case has already been decided');

  await db.run('UPDATE quarantine_logs SET status = ?, decision_by = ?, decision_at = nova_now() WHERE id = ?',
    [b.decision, req.user.id, id]);

  if (b.decision === 'scrapped') {
    // Stock was booked in at goods receipt; remove the scrapped quantity again.
    const lot = await db.get('SELECT id FROM inventory_lots WHERE lot_number = ?', [log.lot_number]);
    if (lot) await db.run('UPDATE inventory_lots SET quantity = quantity - ? WHERE id = ?', [log.quantity, lot.id]);
    await db.run('UPDATE stock_levels SET quantity = quantity - ?, last_updated = nova_now() WHERE item_id = ?', [log.quantity, log.item_id]);
    await db.run(`
      INSERT INTO stock_transactions (item_id, lot_id, quantity, type, reference_type, reference_id, user_id)
      VALUES (?, ?, ?, 'out', 'scrap', ?, ?)`,
    [log.item_id, lot?.id ?? null, -log.quantity, id, req.user.id]);
  }

  if (log.receipt_item_id) {
    await db.run('UPDATE goods_receipt_items SET quality_status = ? WHERE id = ?',
      [b.decision === 'released' ? 'ok' : 'rejected', log.receipt_item_id]);
  }
  res.json({ success: true });
}));

module.exports = router;
