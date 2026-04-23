const express = require('express');
const { db } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/stock — get all stock levels
router.get('/', authenticateToken, (req, res) => {
  const stock = db.prepare(`
    SELECT sl.*, i.item_code, i.name as item_name, i.type, i.uom
    FROM stock_levels sl
    JOIN items i ON sl.item_id = i.id
    ORDER BY i.item_code ASC
  `).all();
  res.json(stock);
});

// POST /api/stock/adjust — manual stock adjustment
router.post('/adjust', authenticateToken, requireRole('planner', 'administrator'), (req, res) => {
  const { item_id, quantity, location, notes } = req.body;
  if (!item_id || quantity === undefined) return res.status(400).json({ error: 'item_id and quantity are required' });

  try {
    db.transaction(() => {
      // Update or insert stock level
      const existing = db.prepare('SELECT id, quantity FROM stock_levels WHERE item_id = ?').get(item_id);
      if (existing) {
        db.prepare('UPDATE stock_levels SET quantity = ?, location = ?, last_updated = datetime("now") WHERE item_id = ?')
          .run(quantity, location || null, item_id);
      } else {
        db.prepare('INSERT INTO stock_levels (item_id, quantity, location) VALUES (?, ?, ?)')
          .run(item_id, quantity, location || null);
      }

      // Log transaction
      const diff = existing ? quantity - existing.quantity : quantity;
      db.prepare(`
        INSERT INTO stock_transactions (item_id, quantity, type, reference_type, user_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(item_id, diff, 'adjustment', 'manual', req.user.id);
    })();

    res.json({ message: 'Stock adjusted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stock/transactions/:item_id
router.get('/transactions/:item_id', authenticateToken, (req, res) => {
  const transactions = db.prepare(`
    SELECT st.*, u.first_name, u.last_name
    FROM stock_transactions st
    LEFT JOIN users u ON st.user_id = u.id
    WHERE st.item_id = ?
    ORDER BY st.created_at DESC
    LIMIT 50
  `).all(req.params.item_id);
  res.json(transactions);
});

module.exports = router;
