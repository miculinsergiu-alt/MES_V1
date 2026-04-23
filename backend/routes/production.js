const express = require('express');
const { db } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { broadcast } = require('../services/socket');
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
  
  const allocations = db.prepare(sql).all(...params);
  
  return allocations.map(ma => {
    const order = db.prepare('SELECT machine_id, product_name FROM orders WHERE id = ?').get(ma.order_id);
    return { ...ma, machine_id: order?.machine_id, product_name: order?.product_name };
  });
}

// ─── Helper: Deduct Stock based on BOM ─────────────────────────────────────
function deductStock(orderId, producedQty, userId) {
  const order = db.prepare('SELECT bom_id FROM orders WHERE id = ?').get(orderId);
  if (!order || !order.bom_id) return;

  const positions = db.prepare('SELECT item_id, quantity FROM bom_positions WHERE bom_id = ?').all(order.bom_id);
  
  for (const pos of positions) {
    const requiredTotal = pos.quantity * producedQty;
    
    // Update stock level
    db.prepare('UPDATE stock_levels SET quantity = quantity - ?, last_updated = datetime("now") WHERE item_id = ?')
      .run(requiredTotal, pos.item_id);
      
    // Log transaction
    db.prepare(`
      INSERT INTO stock_transactions (item_id, quantity, type, reference_type, reference_id, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(pos.item_id, -requiredTotal, 'out', 'order_completion', orderId, userId);
  }
}

// GET /api/production/allocations
router.get('/allocations', authenticateToken, (req, res) => {
  const { order_id, operator_id, machine_id } = req.query;
  let sql = 'SELECT * FROM machine_allocations WHERE 1=1';
  const params = [];
  if (order_id) { sql += ' AND order_id = ?'; params.push(order_id); }
  if (operator_id) { sql += ' AND operator_id = ?'; params.push(operator_id); }
  if (machine_id) { sql += ' AND machine_id = ?'; params.push(machine_id); }
  sql += ' ORDER BY start_time ASC';
  const allocations = db.prepare(sql).all(...params);
  res.json(allocations);
});

// GET /api/production/operator/:id
router.get('/operator/:id', authenticateToken, (req, res) => {
  const allocations = db.prepare(`
    SELECT * FROM machine_allocations WHERE operator_id = ? ORDER BY start_time ASC
  `).all(req.params.id);

  const result = allocations.map(ma => {
    const order = db.prepare(`
      SELECT product_name, quantity, planned_start, planned_end, status as order_status 
      FROM orders WHERE id = ?
    `).get(ma.order_id);
    return { ...ma, ...order };
  }).filter(ma => ma.order_status !== 'cancelled');

  res.json(result);
});

// GET /api/production/machine/:id/status
router.get('/machine/:id/status', authenticateToken, (req, res) => {
  const now = new Date().toISOString().replace('T',' ').substring(0,19);
  const activeOrder = db.prepare(`
    SELECT * FROM orders WHERE machine_id = ? AND status = 'active'
    ORDER BY planned_start ASC LIMIT 1
  `).get(req.params.id);

  let currentAlloc = null;
  if (activeOrder) {
    currentAlloc = db.prepare(`
      SELECT * FROM machine_allocations 
      WHERE order_id = ? AND datetime(start_time) <= datetime(?) AND datetime(end_time) >= datetime(?)
      LIMIT 1
    `).get(activeOrder.id, now, now);

    if (currentAlloc) {
      const user = db.prepare('SELECT first_name, last_name, badge_number FROM users WHERE id = ?').get(currentAlloc.operator_id);
      currentAlloc = { ...currentAlloc, ...user };
    }
  }

  const results = activeOrder ? db.prepare('SELECT * FROM production_results WHERE order_id = ?').all(activeOrder.id) : [];
  const totalOk = results.reduce((a,r) => a + r.qty_ok, 0);
  const totalFail = results.reduce((a,r) => a + r.qty_fail, 0);
  const produced = totalOk + totalFail;
  const progress = activeOrder ? Math.round((produced / activeOrder.quantity) * 100) : 0;

  res.json({ activeOrder, currentAlloc, progress, totalOk, totalFail, produced });
});

// POST /api/production/allocations
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
      delay_minutes: delayMinutes
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

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
    if (order) {
      const newEnd = new Date(new Date(order.planned_end).getTime() + delayMin * 60000).toISOString().replace('T',' ').substring(0,19);
      db.prepare('UPDATE orders SET planned_end=? WHERE id=?').run(newEnd, order_id);
      db.prepare('INSERT INTO order_delays (order_id, delay_minutes, reason, reported_by, source, applied) VALUES (?,?,?,?,?,1)')
        .run(order_id, delayMin, 'Conflict alocare operator', req.user.id, 'system');
    }
  }

  const result = db.prepare(`
    INSERT INTO machine_allocations (order_id, operator_id, machine_id, start_time, end_time, phase, delay_confirmed, delay_minutes)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(order_id, operator_id, machine_id, start_time, end_time, phase || 'working', conflicts.length > 0 ? 1 : 0, delayMin);

  db.prepare("UPDATE orders SET status='active' WHERE id=? AND status='pending'").run(order_id);

  broadcast('production:allocated', { order_id, machine_id, operator_id });
  res.status(201).json({ id: result.lastInsertRowid, delay_minutes: delayMin, message: 'Operator alocat cu succes' });
});

// POST /api/production/actions
router.post('/actions', authenticateToken, (req, res) => {
  const { allocation_id, action_type, notes } = req.body;
  if (!allocation_id || !action_type) return res.status(400).json({ error: 'Câmpuri obligatorii lipsă' });
  
  db.transaction(() => {
    db.prepare('INSERT INTO operator_actions (allocation_id, action_type, notes) VALUES (?,?,?)').run(allocation_id, action_type, notes || '');

    // Track machine running hours on '_end' actions
    if (action_type.endsWith('_end')) {
      const phase = action_type.replace('_end', '');
      const startAction = db.prepare(`
        SELECT timestamp FROM operator_actions 
        WHERE allocation_id = ? AND action_type = ? 
        ORDER BY timestamp DESC LIMIT 1
      `).get(allocation_id, `${phase}_start`);

      if (startAction) {
        const durationHours = (new Date() - new Date(startAction.timestamp)) / 3600000;
        const alloc = db.prepare('SELECT machine_id FROM machine_allocations WHERE id = ?').get(allocation_id);
        if (alloc) {
          db.prepare('UPDATE machines SET total_running_hours = total_running_hours + ? WHERE id = ?')
            .run(durationHours, alloc.machine_id);
        }
      }
    }
  })();

  broadcast('production:action', { allocation_id, action_type });
  res.status(201).json({ message: 'Acțiune înregistrată' });
});

// POST /api/production/results
router.post('/results', authenticateToken, (req, res) => {
  const { order_id, qty_ok, qty_fail, defects } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id obligatoriu' });

  db.transaction(() => {
    const result = db.prepare('INSERT INTO production_results (order_id, operator_id, qty_ok, qty_fail) VALUES (?,?,?,?)')
      .run(order_id, req.user.id, qty_ok || 0, qty_fail || 0);
    
    const resultId = result.lastInsertRowid;

    if (defects && Array.isArray(defects)) {
      const stmt = db.prepare('INSERT INTO defect_logs (result_id, reason_id, quantity, notes) VALUES (?,?,?,?)');
      for (const d of defects) {
        if (d.quantity > 0) stmt.run(resultId, d.reason_id, d.quantity, d.notes || '');
      }
    }

    // Deduct stock
    deductStock(order_id, (qty_ok || 0) + (qty_fail || 0), req.user.id);

    // Check if order is complete
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
    if (order) {
      const results = db.prepare('SELECT * FROM production_results WHERE order_id = ?').all(order_id);
      const totalProduced = results.reduce((a, r) => a + r.qty_ok + r.qty_fail, 0);
      if (totalProduced >= order.quantity) {
        db.prepare("UPDATE orders SET status='done', actual_end=datetime('now') WHERE id=?").run(order_id);
        broadcast('order:completed', { order_id });
      }
    }
  })();

  broadcast('production:results', { order_id, qty_ok, qty_fail });
  res.status(201).json({ message: 'Rezultate înregistrate' });
});

router.get('/performance', authenticateToken, requireRole('area_supervisor','administrator'), (req, res) => {
  const byMachine = db.prepare(`
    SELECT machine_id, COUNT(*) as total_orders,
    SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status='done' AND datetime(actual_end) <= datetime(planned_end) THEN 1 ELSE 0 END) as on_time
    FROM orders WHERE status != 'cancelled'
    GROUP BY machine_id
  `).all();

  const byOperator = db.prepare(`
    SELECT operator_id, COUNT(*) as total_allocations
    FROM machine_allocations GROUP BY operator_id
  `).all();

  res.json({ byMachine, byOperator });
});

// GET /api/production/actions/:allocation_id
router.get('/actions/:allocation_id', authenticateToken, (req, res) => {
  const actions = db.prepare('SELECT * FROM operator_actions WHERE allocation_id = ? ORDER BY timestamp ASC').all(req.params.allocation_id);
  res.json(actions);
});

// GET /api/production/results/:order_id
router.get('/results/:order_id', authenticateToken, (req, res) => {
  const results = db.prepare('SELECT * FROM production_results WHERE order_id = ? ORDER BY completed_at DESC').all(req.params.order_id);
  const totals = results.reduce((acc, r) => ({ ok: acc.ok + r.qty_ok, fail: acc.fail + r.qty_fail }), { ok: 0, fail: 0 });
  res.json({ results, totals });
});

// GET /api/production/defect-reasons
router.get('/defect-reasons', authenticateToken, (req, res) => {
  const reasons = db.prepare('SELECT * FROM defect_reasons ORDER BY name').all();
  res.json(reasons);
});

// POST /api/production/optimize — calculate best allocations based on skills
router.post('/optimize', authenticateToken, requireRole('shift_responsible', 'administrator'), (req, res) => {
  const { shift_id, date } = req.body;
  if (!shift_id) return res.status(400).json({ error: 'shift_id is required' });

  // 1. Get operators in this shift WITH their skills
  const operatorsRaw = db.prepare(`
    SELECT u.id, u.first_name, u.last_name, u.badge_number
    FROM shift_members sm
    JOIN users u ON sm.user_id = u.id
    WHERE sm.shift_id = ? AND u.role = 'operator' AND u.active = 1
  `).all(shift_id);

  const operators = operatorsRaw.map(op => {
    const skills = db.prepare('SELECT machine_id FROM operator_skills WHERE user_id = ?').all(op.id);
    return { ...op, machine_skills: skills.map(s => s.machine_id) };
  });

  if (operators.length === 0) return res.status(400).json({ error: 'No operators found in this shift' });

  // 2. Get pending orders
  const targetDate = date || new Date().toISOString().substring(0, 10);
  const orders = db.prepare(`
    SELECT * FROM orders 
    WHERE status IN ('pending', 'active') 
    AND (date(planned_start) = date(?) OR date(planned_end) = date(?))
    ORDER BY planned_start ASC
  `).all(targetDate, targetDate);

  if (orders.length === 0) return res.status(400).json({ error: 'No pending orders found' });

  // 3. Skill-Aware Allocation Algorithm
  const suggested = [];
  const operatorFreeTime = {}; // userId -> timestamp
  operators.forEach(op => { operatorFreeTime[op.id] = null; });

  for (const order of orders) {
    // Find operators who HAVE THE SKILL for this specific machine
    const skilledOperators = operators.filter(op => op.machine_skills.includes(order.machine_id));
    
    if (skilledOperators.length === 0) {
      suggested.push({
        order_id: order.id,
        product_name: order.product_name,
        machine_id: order.machine_id,
        error: 'Niciun operator cu skill pe acest utilaj'
      });
      continue;
    }

    // Among skilled operators, find the one who is free earliest
    let bestOperator = null;
    let earliestTime = Infinity;

    for (const op of skilledOperators) {
      const freeAt = operatorFreeTime[op.id] ? new Date(operatorFreeTime[op.id]) : new Date(0);
      if (freeAt < earliestTime) {
        earliestTime = freeAt;
        bestOperator = op;
      }
    }

    if (bestOperator) {
      const orderStart = new Date(order.planned_start);
      const orderEnd = new Date(order.planned_end);
      
      let actualStart = orderStart;
      let delayMinutes = 0;

      if (earliestTime > orderStart) {
        actualStart = earliestTime;
        delayMinutes = Math.ceil((earliestTime - orderStart) / 60000);
      }

      const actualEnd = new Date(actualStart.getTime() + (orderEnd - orderStart));

      suggested.push({
        order_id: order.id,
        product_name: order.product_name,
        machine_id: order.machine_id,
        operator_id: bestOperator.id,
        operator_name: `${bestOperator.first_name} ${bestOperator.last_name}`,
        planned_start: order.planned_start,
        suggested_start: actualStart.toISOString().replace('T', ' ').substring(0, 19),
        suggested_end: actualEnd.toISOString().replace('T', ' ').substring(0, 19),
        delay_minutes: delayMinutes,
        is_skill_match: true
      });

      operatorFreeTime[bestOperator.id] = actualEnd.toISOString();
    }
  }

  res.json({
    date: targetDate,
    operators_count: operators.length,
    orders_count: orders.length,
    suggested
  });
});

module.exports = router;
