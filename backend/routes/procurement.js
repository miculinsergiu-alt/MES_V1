const express = require('express');
const router = express.Router();
const { db } = require('../db/init');

// --- Purchase Orders ---
router.get('/purchase-orders', (req, res) => {
  try {
    const pos = db.prepare(`
      SELECT po.*, s.name as supplier_name 
      FROM purchase_orders po
      JOIN suppliers s ON po.supplier_id = s.id
      ORDER BY po.created_at DESC
    `).all();
    res.json(pos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/purchase-orders', (req, res) => {
  const { supplier_id, expected_date, items, created_by } = req.body;
  const transaction = db.transaction(() => {
    const poResult = db.prepare(`
      INSERT INTO purchase_orders (supplier_id, expected_date, created_by)
      VALUES (?, ?, ?)
    `).run(supplier_id, expected_date, created_by);
    
    const poId = poResult.lastInsertRowid;
    const stmt = db.prepare(`
      INSERT INTO purchase_order_items (po_id, item_id, quantity_ordered, unit_price)
      VALUES (?, ?, ?, ?)
    `);
    
    for (const item of items) {
      stmt.run(poId, item.item_id, item.quantity_ordered, item.unit_price);
    }
    return poId;
  });

  try {
    const poId = transaction();
    res.json({ id: poId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/purchase-orders/:id/items', (req, res) => {
  try {
    const items = db.prepare(`
      SELECT poi.*, i.name, i.item_code, i.uom
      FROM purchase_order_items poi
      JOIN items i ON poi.item_id = i.id
      WHERE poi.po_id = ?
    `).all(req.params.id);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Goods Receipt (Recepție Marfă) ---
router.post('/receipts', (req, res) => {
  const { po_id, received_by, document_reference, notes, items } = req.body;
  
  const transaction = db.transaction(() => {
    // 1. Create Receipt Header
    const receiptResult = db.prepare(`
      INSERT INTO goods_receipts (po_id, received_by, document_reference, notes)
      VALUES (?, ?, ?, ?)
    `).run(po_id, received_by, document_reference, notes);
    
    const receiptId = receiptResult.lastInsertRowid;
    
    for (const item of items) {
      // 2. Create Receipt Item
      db.prepare(`
        INSERT INTO goods_receipt_items (receipt_id, item_id, lot_number, quantity_received, location_id, quality_status, expiration_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(receiptId, item.item_id, item.lot_number, item.quantity_received, item.location_id, item.quality_status || 'ok', item.expiration_date);

      // 3. Update/Create Inventory Lot
      db.prepare(`
        INSERT INTO inventory_lots (item_id, lot_number, quantity, expiration_date)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(lot_number) DO UPDATE SET quantity = quantity + EXCLUDED.quantity
      `).run(item.item_id, item.lot_number, item.quantity_received, item.expiration_date);

      // 4. Update Stock Level (Main table)
      db.prepare(`
        INSERT INTO stock_levels (item_id, quantity, last_updated)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(item_id) DO UPDATE SET quantity = quantity + EXCLUDED.quantity, last_updated = datetime('now')
      `).run(item.item_id, item.quantity_received);

      // 5. Update PO Item received quantity
      if (po_id) {
        db.prepare(`
          UPDATE purchase_order_items 
          SET quantity_received = quantity_received + ?
          WHERE po_id = ? AND item_id = ?
        `).run(item.quantity_received, po_id, item.item_id);
      }

      // 6. Log Transaction
      db.prepare(`
        INSERT INTO stock_transactions (item_id, lot_id, quantity, type, reference_type, reference_id, user_id)
        VALUES (?, (SELECT id FROM inventory_lots WHERE lot_number = ?), ?, 'in', 'receipt', ?, ?)
      `).run(item.item_id, item.lot_number, item.quantity_received, receiptId, received_by);

      // 7. If Quality Status is Quarantine, log it
      if (item.quality_status === 'quarantine') {
        db.prepare(`
          INSERT INTO quarantine_logs (item_id, lot_number, quantity, reason, reported_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(item.item_id, item.lot_number, item.quantity_received, 'Recepție cu probleme/Carantină', received_by);
      }
    }

    // 8. Update PO Status if all items received
    if (po_id) {
      const pendingItems = db.prepare(`
        SELECT COUNT(*) as count FROM purchase_order_items 
        WHERE po_id = ? AND quantity_received < quantity_ordered
      `).get(po_id).count;
      
      const status = pendingItems === 0 ? 'received' : 'partial';
      db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(status, po_id);
    }

    return receiptId;
  });

  try {
    const receiptId = transaction();
    res.json({ id: receiptId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
