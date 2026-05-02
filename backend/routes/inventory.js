const express = require('express');
const router = express.Router();
const { db } = require('../db/init');
const { authenticateToken } = require('../middleware/auth');

// Internal Transfer
router.post('/transfers', authenticateToken, (req, res) => {
  const { from_warehouse_id, to_warehouse_id, items, created_by } = req.body;
  
  const transaction = db.transaction(() => {
    const transferResult = db.prepare(`
      INSERT INTO stock_transfers (from_warehouse_id, to_warehouse_id, created_by, completed_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(from_warehouse_id, to_warehouse_id, created_by);
    
    const transferId = transferResult.lastInsertRowid;
    
    for (const item of items) {
      // 1. Log Transfer Item
      db.prepare(`
        INSERT INTO stock_transfer_items (transfer_id, item_id, lot_number, quantity, from_location_id, to_location_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(transferId, item.item_id, item.lot_number, item.quantity, item.from_location_id, item.to_location_id);

      // 2. Log Transactions (Out from source, In to destination - though overall stock same, locations change)
      // Actually, we update the location_id in goods_receipt_items for the specific lot if we track per location
      // Or we just log it in transactions. In our schema, stock_levels doesn't have multiple locations per item easily without a pivot.
      // But we have warehouse_locations.
      
      db.prepare(`
        INSERT INTO stock_transactions (item_id, lot_id, quantity, type, reference_type, reference_id, user_id)
        VALUES (?, (SELECT id FROM inventory_lots WHERE lot_number = ?), ?, 'adjustment', 'transfer_out', ?, ?)
      `).run(item.item_id, item.lot_number, -item.quantity, transferId, created_by);

      db.prepare(`
        INSERT INTO stock_transactions (item_id, lot_id, quantity, type, reference_type, reference_id, user_id)
        VALUES (?, (SELECT id FROM inventory_lots WHERE lot_number = ?), ?, 'adjustment', 'transfer_in', ?, ?)
      `).run(item.item_id, item.lot_number, item.quantity, transferId, created_by);
      
      // Update location of the lot in receipt records if needed
      if (item.to_location_id) {
          db.prepare(`
            UPDATE goods_receipt_items 
            SET location_id = ? 
            WHERE lot_number = ? AND item_id = ?
          `).run(item.to_location_id, item.lot_number, item.item_id);
      }
    }
    return transferId;
  });

  try {
    const transferId = transaction();
    res.json({ id: transferId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lot Traceability
router.get('/traceability/:lotNumber', (req, res) => {
  try {
    const lot = db.prepare(`
      SELECT il.*, i.name as item_name, i.item_code, i.uom
      FROM inventory_lots il
      JOIN items i ON il.item_id = i.id
      WHERE il.lot_number = ?
    `).get(req.params.lotNumber);

    if (!lot) return res.status(404).json({ error: 'Lot not found' });

    const transactions = db.prepare(`
      SELECT st.*, u.first_name || ' ' || u.last_name as user_name
      FROM stock_transactions st
      LEFT JOIN users u ON st.user_id = u.id
      WHERE st.lot_id = ?
      ORDER BY st.created_at ASC
    `).all(lot.id);

    res.json({ lot, transactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
