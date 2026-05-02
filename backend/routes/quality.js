const express = require('express');
const router = express.Router();
const { db } = require('../db/init');

// List quarantine logs
router.get('/quarantine', (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT ql.*, i.name as item_name, i.item_code, i.uom, u.first_name || ' ' || u.last_name as reporter_name
      FROM quarantine_logs ql
      JOIN items i ON ql.item_id = i.id
      JOIN users u ON ql.reported_by = u.id
      WHERE ql.status = 'pending'
      ORDER BY ql.created_at DESC
    `).all();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve quarantine
router.put('/quarantine/:id/resolve', (req, res) => {
  const { decision, decision_by, notes } = req.body;
  
  const transaction = db.transaction(() => {
    const log = db.prepare('SELECT * FROM quarantine_logs WHERE id = ?').get(req.params.id);
    if (!log) throw new Error('Quarantine log not found');

    db.prepare(`
      UPDATE quarantine_logs 
      SET status = ?, decision_by = ?, decision_at = datetime('now')
      WHERE id = ?
    `).run(decision, decision_by, req.params.id);

    if (decision === 'scrapped') {
      // Deduct from stock if it was already added during receipt
      db.prepare(`
        UPDATE inventory_lots 
        SET quantity = quantity - ? 
        WHERE lot_number = ?
      `).run(log.quantity, log.lot_number);

      db.prepare(`
        UPDATE stock_levels 
        SET quantity = quantity - ? 
        WHERE item_id = ?
      `).run(log.quantity, log.item_id);

      db.prepare(`
        INSERT INTO stock_transactions (item_id, lot_id, quantity, type, reference_type, reference_id, user_id)
        VALUES (?, (SELECT id FROM inventory_lots WHERE lot_number = ?), ?, 'out', 'scrap', ?, ?)
      `).run(log.item_id, log.lot_number, log.quantity, req.params.id, decision_by);
    }
    // If 'released', we don't need to do anything to stock as it was already added in 'in' status
    // but marked as 'quarantine' in goods_receipt_items. 
    // Usually, we'd update quality_status in goods_receipt_items too.
    if (log.receipt_item_id) {
        db.prepare('UPDATE goods_receipt_items SET quality_status = ? WHERE id = ?')
          .run(decision === 'released' ? 'ok' : 'rejected', log.receipt_item_id);
    }

    return true;
  });

  try {
    transaction();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
