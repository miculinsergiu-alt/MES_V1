const express = require('express');
const { db, machinesDb } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/oee — Global OEE or by Machine
router.get('/', authenticateToken, (req, res) => {
  const { date_from, date_to, machine_id } = req.query;
  
  // Default to today
  const targetDate = date_from || new Date().toISOString().substring(0, 10);
  
  let machines = machinesDb.prepare('SELECT * FROM machines WHERE active = 1').all();
  if (machine_id) machines = machines.filter(m => m.id === parseInt(machine_id));

  const oeeResults = [];

  for (const m of machines) {
    // Get all completed/active orders for this machine on the target date
    const orders = db.prepare(`
      SELECT o.*, i.production_time_min 
      FROM orders o
      LEFT JOIN items i ON o.item_id = i.id
      WHERE o.machine_id = ? AND o.status != 'cancelled'
      AND date(o.planned_start) = ?
    `).all(m.id, targetDate);

    if (orders.length === 0) continue;

    let totalPlannedTimeMin = 0;
    let totalOperatingTimeMin = 0;
    let totalProduced = 0;
    let totalOk = 0;
    let idealTimeNeededMin = 0;

    for (const o of orders) {
      // Planned time
      const pStart = new Date(o.planned_start);
      const pEnd = new Date(o.planned_end);
      totalPlannedTimeMin += (pEnd - pStart) / 60000;

      // Operating time (Working phase only)
      const allocs = db.prepare('SELECT * FROM machine_allocations WHERE order_id = ? AND phase = "working"').all(o.id);
      for (const a of allocs) {
        // Find end timestamp from operator_actions
        const startAction = db.prepare("SELECT timestamp FROM operator_actions WHERE allocation_id = ? AND action_type = 'working_start' ORDER BY timestamp DESC LIMIT 1").get(a.id);
        const endAction = db.prepare("SELECT timestamp FROM operator_actions WHERE allocation_id = ? AND action_type = 'working_end' ORDER BY timestamp DESC LIMIT 1").get(a.id);
        
        let startTs = startAction ? new Date(startAction.timestamp) : new Date(a.start_time);
        let endTs = endAction ? new Date(endAction.timestamp) : (o.status === 'active' ? new Date() : new Date(a.end_time));
        
        totalOperatingTimeMin += (endTs - startTs) / 60000;
      }

      // Quality & Performance
      const results = db.prepare('SELECT * FROM production_results WHERE order_id = ?').all(o.id);
      for (const r of results) {
        totalProduced += (r.qty_ok + r.qty_fail);
        totalOk += r.qty_ok;
      }
      
      // Ideal time
      if (o.production_time_min) {
        idealTimeNeededMin += (totalProduced * o.production_time_min);
      }
    }

    // Availability = Operating Time / Planned Time
    const availability = totalPlannedTimeMin > 0 ? (totalOperatingTimeMin / totalPlannedTimeMin) : 0;

    // Performance = Ideal Time / Operating Time
    const performance = totalOperatingTimeMin > 0 ? (idealTimeNeededMin / totalOperatingTimeMin) : 0;

    // Quality = Good Pieces / Total Pieces
    const quality = totalProduced > 0 ? (totalOk / totalProduced) : 0;

    // OEE
    const oee = availability * performance * quality;

    oeeResults.push({
      machine_id: m.id,
      machine_name: m.name,
      availability: Math.min(1, Math.max(0, availability)),
      performance: Math.min(1, Math.max(0, performance)),
      quality: Math.min(1, Math.max(0, quality)),
      oee: Math.min(1, Math.max(0, oee)),
      metrics: {
        planned_time_min: Math.round(totalPlannedTimeMin),
        operating_time_min: Math.round(totalOperatingTimeMin),
        total_produced: totalProduced,
        total_ok: totalOk
      }
    });
  }

  res.json({ date: targetDate, results: oeeResults });
});

module.exports = router;
