const express = require('express');
const { productionDb, ordersDb, usersDb } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// ─── Helper: check operator conflict ───────────────────────────────────────
function checkOperatorConflict(operatorId, startTime, endTime, excludeAllocationId = null) {
  let sql = `
    SELECT * FROM machine_allocations 
    WHERE operator_id = ?
    AND phase IN ('setup', 'working')
    AND datetime(start_time) < datetime(?)
    AND datetime(end_time) > datetime(?)
  `;
  const params = [operatorId, endTime, startTime];
  if (excludeAllocationId) { sql += ' AND id != ?'; params.push(excludeAllocationId); }
  
  const allocations = productionDb.prepare(sql).all(...params);
  
  // Attach order info manually since they are in different DB files
  return allocations.map(ma => {
    const order = ordersDb.prepare('SELECT machine_id, product_name FROM orders WHERE id = ?').get(ma.order_id);
    return { ...ma, machine_id: order?.machine_id, product_name: order?.product_name };
  });
}

// GET /api/production/allocations — all allocations
router.get('/allocations', authenticateToken, (req, res) => {
  const { order_id, operator_id, machine_id } = req.query;
  let sql = 'SELECT * FROM machine_allocations WHERE 1=1';
  const params = [];
  if (order_id) { sql += ' AND order_id = ?'; params.push(order_id); }
  if (operator_id) { sql += ' AND operator_id = ?'; params.push(operator_id); }
  if (machine_id) { sql += ' AND machine_id = ?'; params.push(machine_id); }
  sql += ' ORDER BY start_time ASC';
  const allocations = productionDb.prepare(sql).all(...params);
  res.json(allocations);
});

// GET /api/production/operator/:id — operator's allocations with order info
router.get('/operator/:id', authenticateToken, (req, res) => {
  const allocations = productionDb.prepare(`
    SELECT * FROM machine_allocations WHERE operator_id = ? ORDER BY start_time ASC
  `).all(req.params.id);

  // Join with orders in JS
  const result = allocations.map(ma => {
    const order = ordersDb.prepare(`
      SELECT product_name, quantity, planned_start, planned_end, status as order_status 
      FROM orders WHERE id = ?
    `).get(ma.order_id);
    return { ...ma, ...order };
  }).filter(ma => ma.order_status !== 'cancelled');

  res.json(result);
});

// GET /api/production/machine/:id/status — machine current status
router.get('/machine/:id/status', authenticateToken, (req, res) => {
  const now = new Date().toISOString().replace('T',' ').substring(0,19);
  const activeOrder = ordersDb.prepare(`
    SELECT * FROM orders WHERE machine_id = ? AND status = 'active'
    ORDER BY planned_start ASC LIMIT 1
  `).get(req.params.id);

  let currentAlloc = null;
  if (activeOrder) {
    currentAlloc = productionDb.prepare(`
      SELECT * FROM machine_allocations 
      WHERE order_id = ? AND datetime(start_time) <= datetime(?) AND datetime(end_time) >= datetime(?)
      LIMIT 1
    `).get(activeOrder.id, now, now);

    if (currentAlloc) {
      const user = usersDb.prepare('SELECT first_name, last_name, badge_number FROM users WHERE id = ?').get(currentAlloc.operator_id);
      currentAlloc = { ...currentAlloc, ...user };
    }
  }

  const results = activeOrder ? productionDb.prepare('SELECT * FROM production_results WHERE order_id = ?').all(activeOrder.id) : [];
  const totalOk = results.reduce((a,r) => a + r.qty_ok, 0);
  const totalFail = results.reduce((a,r) => a + r.qty_fail, 0);
  const produced = totalOk + totalFail;
  const progress = activeOrder ? Math.round((produced / activeOrder.quantity) * 100) : 0;

  res.json({ activeOrder, currentAlloc, progress, totalOk, totalFail, produced });
});

// POST /api/production/allocations — assign operator to order/machine
router.post('/allocations', authenticateToken, requireRole('shift_responsible','administrator'), (req, res) => {
  const { order_id, operator_id, machine_id, start_time, end_time, phase, force_with_delay } = req.body;
  if (!order_id || !operator_id || !machine_id || !start_time || !end_time) {
    return res.status(400).json({ error: 'Câmpuri obligatorii lipsă' });
  }

  const conflicts = checkOperatorConflict(operator_id, start_time, end_time);
  if (conflicts.length > 0 && !force_with_delay) {
    const overlapMs = conflicts.reduce((total, c) => {
      const overlapStart = new Date(Math.max(new Date(start_time), new Date(c.start_time)));
      const overlapEnd = new Date(Math.min(new Date(end_time), new Date(c.end_time)));
      return total + Math.max(0, overlapEnd - overlapStart);
    }, 0);
    const delayMinutes = Math.ceil(overlapMs / 60000);

    return res.status(409).json({
      error: 'Conflict de alocare',
      conflicts,
      delay_minutes: delayMinutes,
      message: `Operatorul este alocat pe Utilajul ${conflicts[0].machine_id} în intervalul ${conflicts[0].start_time} – ${conflicts[0].end_time} (${conflicts[0].phase}). Se va crea un delay de ${delayMinutes} minute la noua alocare.`
    });
  }

  let delayMin = 0;
  if (conflicts.length > 0 && force_with_delay) {
    const overlapMs = conflicts.reduce((total, c) => {
      const overlapStart = new Date(Math.max(new Date(start_time), new Date(c.start_time)));
      const overlapEnd = new Date(Math.min(new Date(end_time), new Date(c.end_time)));
      return total + Math.max(0, overlapEnd - overlapStart);
    }, 0);
    delayMin = Math.ceil(overlapMs / 60000);

    const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
    if (order) {
      const newEnd = new Date(new Date(order.planned_end).getTime() + delayMin * 60000).toISOString().replace('T',' ').substring(0,19);
      ordersDb.prepare('UPDATE orders SET planned_end=? WHERE id=?').run(newEnd, order_id);
      ordersDb.prepare('INSERT INTO order_delays (order_id, delay_minutes, reason, reported_by, source, applied) VALUES (?,?,?,?,?,1)')
        .run(order_id, delayMin, 'Conflict alocare operator', req.user.id, 'system');
    }
  }

  const result = productionDb.prepare(`
    INSERT INTO machine_allocations (order_id, operator_id, machine_id, start_time, end_time, phase, delay_confirmed, delay_minutes)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(order_id, operator_id, machine_id, start_time, end_time, phase || 'working', conflicts.length > 0 ? 1 : 0, delayMin);

  ordersDb.prepare("UPDATE orders SET status='active' WHERE id=? AND status='pending'").run(order_id);

  res.status(201).json({ id: result.lastInsertRowid, delay_minutes: delayMin, message: 'Operator alocat cu succes' });
});

// DELETE /api/production/allocations/:id
router.delete('/allocations/:id', authenticateToken, requireRole('shift_responsible','administrator'), (req, res) => {
  productionDb.prepare('DELETE FROM machine_allocations WHERE id=?').run(req.params.id);
  res.json({ message: 'Alocare ștearsă' });
});

// POST /api/production/actions — operator logs an action
router.post('/actions', authenticateToken, (req, res) => {
  const { allocation_id, action_type, notes } = req.body;
  if (!allocation_id || !action_type) return res.status(400).json({ error: 'Câmpuri obligatorii lipsă' });
  const validActions = ['setup_start','setup_end','working_start','working_end','supervision_start','supervision_end','delay_start','delay_end'];
  if (!validActions.includes(action_type)) return res.status(400).json({ error: 'Tip acțiune invalid' });

  productionDb.prepare('INSERT INTO operator_actions (allocation_id, action_type, notes) VALUES (?,?,?)').run(allocation_id, action_type, notes || '');
  res.status(201).json({ message: 'Acțiune înregistrată' });
});

// GET /api/production/actions/:allocation_id
router.get('/actions/:allocation_id', authenticateToken, (req, res) => {
  const actions = productionDb.prepare('SELECT * FROM operator_actions WHERE allocation_id = ? ORDER BY timestamp ASC').all(req.params.allocation_id);
  res.json(actions);
});

// POST /api/production/results — submit production results
router.post('/results', authenticateToken, (req, res) => {
  const { order_id, qty_ok, qty_fail, defects } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id obligatoriu' });

  const result = productionDb.prepare('INSERT INTO production_results (order_id, operator_id, qty_ok, qty_fail) VALUES (?,?,?,?)')
    .run(order_id, req.user.id, qty_ok || 0, qty_fail || 0);
  
  const resultId = result.lastInsertRowid;

  // Log detailed defects if provided
  if (defects && Array.isArray(defects)) {
    const stmt = productionDb.prepare('INSERT INTO defect_logs (result_id, reason_id, quantity, notes) VALUES (?,?,?,?)');
    for (const d of defects) {
      if (d.quantity > 0) stmt.run(resultId, d.reason_id, d.quantity, d.notes || '');
    }
  }

  // Check if order is complete
  const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
  if (order) {
    const results = productionDb.prepare('SELECT * FROM production_results WHERE order_id = ?').all(order_id);
    const totalProduced = results.reduce((a, r) => a + r.qty_ok + r.qty_fail, 0);
    if (totalProduced >= order.quantity) {
      ordersDb.prepare("UPDATE orders SET status='done', actual_end=datetime('now') WHERE id=?").run(order_id);
    }
  }

  res.status(201).json({ id: resultId, message: 'Rezultate înregistrate' });
});

// GET /api/production/results/:order_id
router.get('/results/:order_id', authenticateToken, (req, res) => {
  const results = productionDb.prepare('SELECT * FROM production_results WHERE order_id = ? ORDER BY completed_at DESC').all(req.params.order_id);
  const totals = results.reduce((acc, r) => ({ ok: acc.ok + r.qty_ok, fail: acc.fail + r.qty_fail }), { ok: 0, fail: 0 });
  res.json({ results, totals });
});

// GET /api/production/performance — performance report
router.get('/performance', authenticateToken, requireRole('area_supervisor','administrator'), (req, res) => {
  // Performance per machine
  const byMachine = ordersDb.prepare(`
    SELECT machine_id, COUNT(*) as total_orders,
    SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status='done' AND actual_end <= planned_end THEN 1 ELSE 0 END) as on_time
    FROM orders WHERE status != 'cancelled'
    GROUP BY machine_id
  `).all();

  // Performance per operator
  const byOperator = productionDb.prepare(`
    SELECT operator_id, COUNT(*) as total_allocations
    FROM machine_allocations GROUP BY operator_id
  `).all();

  res.json({ byMachine, byOperator });
});

// GET /api/production/defect-reasons
router.get('/defect-reasons', authenticateToken, (req, res) => {
  const reasons = productionDb.prepare('SELECT * FROM defect_reasons ORDER BY name').all();
  res.json(reasons);
});

module.exports = router;
