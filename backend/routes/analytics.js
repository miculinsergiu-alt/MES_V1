const express = require('express');
const { db } = require('../db/init');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// GET /api/analytics/summary — Global summary for delays and costs
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    // 1. Delay Reasons (Pareto)
    const delays = db.prepare(`
      SELECT dr.name as reason, SUM(od.delay_minutes) as total_minutes
      FROM order_delays od
      JOIN delay_reasons dr ON od.delay_reason_id = dr.id
      WHERE od.applied = 1
      GROUP BY dr.id
      ORDER BY total_minutes DESC
    `).all();

    // 2. Cost Analysis (Standard vs Real)
    // We'll look at the last 10 completed orders with BOMs
    const orders = db.prepare(`
      SELECT o.id, o.product_name, o.quantity, o.actual_end
      FROM orders o
      WHERE o.status = 'done' AND o.bom_id IS NOT NULL
      ORDER BY o.actual_end DESC
      LIMIT 10
    `).all();

    const costAnalysis = orders.map(o => {
      // Standard Cost (from BOM)
      const std = db.prepare(`
        SELECT SUM(bp.quantity * i.acquisition_cost) as total_std
        FROM bom_positions bp
        JOIN items i ON bp.item_id = i.id
        WHERE bp.bom_id = (SELECT bom_id FROM orders WHERE id = ?)
      `).get(o.id);
      
      const standardTotal = (std.total_std || 0) * o.quantity;

      // Real Cost (from recorded material lots)
      const real = db.prepare(`
        SELECT SUM(oml.quantity_used * i.acquisition_cost) as total_real
        FROM order_material_lots oml
        JOIN items i ON oml.item_id = i.id
        WHERE oml.order_id = ?
      `).get(o.id);

      const realTotal = real.total_real || 0;

      return {
        order_id: o.id,
        product: o.product_name,
        standard_cost: standardTotal,
        real_cost: realTotal,
        variance: realTotal - standardTotal,
        variance_percent: standardTotal > 0 ? ((realTotal - standardTotal) / standardTotal * 100) : 0
      };
    });

    res.json({
      delays,
      costs: costAnalysis
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
