const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// GET /api/analytics/summary — delay Pareto and standard-vs-actual material cost
router.get('/summary', h(async (req, res) => {
  const delays = await db.all(`
    SELECT dr.name AS reason, SUM(od.delay_minutes) AS total_minutes
    FROM order_delays od JOIN delay_reasons dr ON od.delay_reason_id = dr.id
    WHERE od.applied = 1
    GROUP BY dr.id
    ORDER BY total_minutes DESC`);

  // Last 10 finished orders that have a BOM
  const costs = await db.all(`
    SELECT o.id AS order_id, o.product_name AS product, o.quantity,
      COALESCE((SELECT SUM(bp.quantity * i.acquisition_cost)
                FROM bom_positions bp JOIN items i ON bp.item_id = i.id
                WHERE bp.bom_id = o.bom_id), 0) * o.quantity AS standard_cost,
      COALESCE((SELECT SUM(oml.quantity_used * i.acquisition_cost)
                FROM order_material_lots oml JOIN items i ON oml.item_id = i.id
                WHERE oml.order_id = o.id), 0) AS real_cost
    FROM orders o
    WHERE o.status = 'done' AND o.bom_id IS NOT NULL
    ORDER BY o.actual_end DESC NULLS LAST
    LIMIT 10`);

  res.json({
    delays,
    costs: costs.map((c) => ({
      order_id: c.order_id,
      product: c.product,
      standard_cost: c.standard_cost,
      real_cost: c.real_cost,
      variance: c.real_cost - c.standard_cost,
      variance_percent: c.standard_cost > 0 ? ((c.real_cost - c.standard_cost) / c.standard_cost) * 100 : 0,
    })),
  });
}));

module.exports = router;
