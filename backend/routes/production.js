const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, forbidden, AppError, badRequest } = require('../lib/errors');
const { nowLocal, todayLocal, parseLocal, formatLocal, diffMinutes } = require('../lib/time');
const { authenticateToken, requireRole, isOnlyOperator } = require('../middleware/auth');
const { broadcast } = require('../services/socket');
const { propagateDelay } = require('./orders');
const stock = require('../services/stock');
const costing = require('../services/costing');

const router = express.Router();
router.use(authenticateToken);

const ACTION_TYPES = ['setup_start', 'setup_end', 'working_start', 'working_end', 'supervision_start', 'supervision_end', 'delay_start', 'delay_end'];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Allocations of an operator (setup/working) that overlap [start, end). */
async function findOperatorConflicts(operatorId, start, end) {
  return db.all(`
    SELECT ma.*, o.machine_id AS order_machine_id, o.product_name
    FROM machine_allocations ma JOIN orders o ON ma.order_id = o.id
    WHERE ma.operator_id = ? AND ma.phase IN ('setup','working')
      AND ma.start_time::timestamp < ?::timestamp AND ma.end_time::timestamp > ?::timestamp`,
  [operatorId, end, start]);
}

function overlapMinutes(start, end, conflicts) {
  const s = parseLocal(start); const e = parseLocal(end);
  const ms = conflicts.reduce((sum, c) => sum + Math.max(0, Math.min(e, parseLocal(c.end_time)) - Math.max(s, parseLocal(c.start_time))), 0);
  return Math.ceil(ms / 60000);
}

/**
 * Books material consumption for produced quantity (good + scrap).
 * Only the first step of a routing chain consumes material. Material is
 * taken from lots first-in-first-out (or the lot the operator scanned), and
 * the lots used are recorded for traceability.
 */
async function deductStock(orderId, producedQty, userId, preferLotNumber) {
  const order = await db.get('SELECT bom_id, parent_order_id FROM orders WHERE id = ?', [orderId]);
  if (!order || order.parent_order_id !== null || !order.bom_id) return;

  const positions = await db.all(`
    SELECT item_id, SUM(quantity) AS quantity FROM bom_positions
    WHERE bom_id = ? AND node_type = 'component' AND item_id IS NOT NULL
    GROUP BY item_id`, [order.bom_id]);

  for (const pos of positions) {
    const required = Math.round(pos.quantity * producedQty * 1e6) / 1e6;
    if (required <= 0) continue;

    const alloc = await db.get('SELECT * FROM order_material_allocations WHERE order_id = ? AND item_id = ? FOR UPDATE', [orderId, pos.item_id]);
    if (alloc) {
      const used = Math.min(alloc.allocated_qty, required);
      if (used > 0) {
        await db.run('UPDATE stock_levels SET allocated_quantity = GREATEST(0, allocated_quantity - ?) WHERE item_id = ?', [used, pos.item_id]);
        const remaining = alloc.allocated_qty - used;
        if (remaining <= 0) await db.run('DELETE FROM order_material_allocations WHERE id = ?', [alloc.id]);
        else await db.run('UPDATE order_material_allocations SET allocated_qty = ? WHERE id = ?', [remaining, alloc.id]);
      }
    }
    await stock.consume({
      itemId: pos.item_id, qty: required, referenceType: 'order_completion', referenceId: orderId, userId, orderId, preferLotNumber,
    });
  }
}

/** Root order of a routing chain and whether this order is its last step. */
async function chainInfo(order) {
  const rootId = order.parent_order_id || order.id;
  const later = await db.get(`
    SELECT id FROM orders
    WHERE (parent_order_id = ? OR id = ?) AND routing_sequence > ? AND status <> 'cancelled' LIMIT 1`,
  [rootId, rootId, order.routing_sequence || 0]);
  return { rootId, isLastStep: !later };
}

/**
 * Books good parts of the last production step into stock, in a production
 * lot per order ("FA-<order number>") so customers' deliveries can be traced
 * back to the materials used.
 */
async function bookFinishedGoods(order, qtyOk, userId) {
  if (!order.item_id || !(qtyOk > 0)) return null;
  const { rootId, isLastStep } = await chainInfo(order);
  if (!isLastStep) return null;
  const lotNumber = `FA-${rootId}`;
  // Value the goods at the actual cost per good piece so far (material, machine, labour).
  const cost = await costing.costOrder(rootId);
  const unitCost = cost?.actual.per_piece > 0 ? cost.actual.per_piece : undefined;
  if (unitCost) await stock.updateAverageCost(order.item_id, qtyOk, unitCost);
  await stock.bookIn({
    itemId: order.item_id, qty: qtyOk, lotNumber, sourceType: 'production', productionOrderId: rootId,
    referenceType: 'production', referenceId: rootId, userId, unitCost,
  });
  return lotNumber;
}

/** Lot the operator scanned at setup start ("Lot: X" in the action notes), if any. */
async function scannedLot(orderId) {
  const a = await db.get(`
    SELECT oa.notes FROM operator_actions oa JOIN machine_allocations ma ON ma.id = oa.allocation_id
    WHERE ma.order_id = ? AND oa.action_type = 'setup_start' AND oa.notes LIKE 'Lot: %'
    ORDER BY oa.id DESC LIMIT 1`, [orderId]);
  return a ? a.notes.slice(5).trim() : undefined;
}

async function getOwnedAllocation(req, allocationId) {
  const alloc = await db.get('SELECT * FROM machine_allocations WHERE id = ?', [allocationId]);
  if (!alloc) throw notFound('Allocation');
  if (isOnlyOperator(req.user) && alloc.operator_id !== req.user.id) {
    throw forbidden('This task is assigned to another operator');
  }
  return alloc;
}

// ─── Read routes ────────────────────────────────────────────────────────────

// GET /api/production/allocations
router.get('/allocations', h(async (req, res) => {
  const q = v.query(req, v.z.object({ order_id: v.optId, operator_id: v.optId, machine_id: v.optId }));
  const params = [];
  let sql = 'SELECT * FROM machine_allocations WHERE 1=1';
  if (q.order_id) { sql += ' AND order_id = ?'; params.push(q.order_id); }
  if (q.operator_id) { sql += ' AND operator_id = ?'; params.push(q.operator_id); }
  if (q.machine_id) { sql += ' AND machine_id = ?'; params.push(q.machine_id); }
  res.json(await db.all(`${sql} ORDER BY start_time::timestamp ASC, id ASC`, params));
}));

// GET /api/production/operator/:id — tasks of an operator
router.get('/operator/:id', h(async (req, res) => {
  const operatorId = v.paramId(req);
  if (isOnlyOperator(req.user) && operatorId !== req.user.id) throw forbidden();
  res.json(await db.all(`
    SELECT ma.*, o.product_name, o.quantity, o.planned_start, o.planned_end, o.status AS order_status, o.item_id
    FROM machine_allocations ma JOIN orders o ON ma.order_id = o.id
    WHERE ma.operator_id = ? AND o.status <> 'cancelled'
    ORDER BY o.planned_start::timestamp ASC`, [operatorId]));
}));

// GET /api/production/machine/:id/status
router.get('/machine/:id/status', h(async (req, res) => {
  const machineId = v.paramId(req);
  const now = nowLocal(req.user.timezone);
  const activeOrder = await db.get(`
    SELECT * FROM orders WHERE machine_id = ? AND status = 'active'
    ORDER BY planned_start::timestamp ASC LIMIT 1`, [machineId]);

  let currentAlloc = null;
  let totals = { ok: 0, fail: 0 };
  if (activeOrder) {
    currentAlloc = await db.get(`
      SELECT ma.*, u.first_name, u.last_name, u.badge_number
      FROM machine_allocations ma LEFT JOIN users u ON ma.operator_id = u.id
      WHERE ma.order_id = ? AND ma.start_time::timestamp <= ?::timestamp AND ma.end_time::timestamp >= ?::timestamp
      LIMIT 1`, [activeOrder.id, now, now]) || null;
    totals = await db.get('SELECT COALESCE(SUM(qty_ok),0) AS ok, COALESCE(SUM(qty_fail),0) AS fail FROM production_results WHERE order_id = ?', [activeOrder.id]);
  }
  const produced = totals.ok + totals.fail;
  const progress = activeOrder ? Math.round((produced / activeOrder.quantity) * 100) : 0;
  res.json({ activeOrder: activeOrder || null, currentAlloc, progress, totalOk: totals.ok, totalFail: totals.fail, produced });
}));

// ─── Allocations ────────────────────────────────────────────────────────────

// POST /api/production/allocations — assign an operator to an order
router.post('/allocations', requireRole('shift_responsible', 'administrator'), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    order_id: v.id,
    operator_id: v.id,
    machine_id: v.id,
    start_time: v.dateTime,
    end_time: v.dateTime,
    phase: v.z.enum(['setup', 'working', 'supervision']).default('working'),
    force_with_delay: v.z.coerce.boolean().default(false),
  }));
  if (diffMinutes(b.end_time, b.start_time) <= 0) throw badRequest('end_time must be after start_time');
  const order = await db.get('SELECT * FROM orders WHERE id = ? FOR UPDATE', [b.order_id]);
  if (!order) throw notFound('Order');

  const conflicts = await findOperatorConflicts(b.operator_id, b.start_time, b.end_time);
  const delayMinutes = conflicts.length ? overlapMinutes(b.start_time, b.end_time, conflicts) : 0;
  if (conflicts.length && !b.force_with_delay) {
    // 409 lets the planner confirm the allocation with the resulting delay.
    throw new AppError(409, 'ALLOCATION_CONFLICT', 'The operator is already allocated in this time window', {
      conflicts: conflicts.map((c) => ({ ...c, machine_id: c.order_machine_id })),
      delay_minutes: delayMinutes,
    });
  }

  if (delayMinutes > 0) {
    await db.run(`
      INSERT INTO order_delays (order_id, delay_minutes, reason, reported_by, source, applied)
      VALUES (?, ?, 'Operator allocation conflict', ?, 'system', 1)`, [b.order_id, delayMinutes, req.user.id]);
    await propagateDelay(b.order_id, delayMinutes);
  }

  const row = await db.get(`
    INSERT INTO machine_allocations (order_id, operator_id, machine_id, start_time, end_time, phase, delay_confirmed, delay_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  [b.order_id, b.operator_id, b.machine_id, b.start_time, b.end_time, b.phase, conflicts.length ? 1 : 0, delayMinutes]);
  await db.run("UPDATE orders SET status = 'active' WHERE id = ? AND status = 'pending'", [b.order_id]);

  broadcast('production:allocated', { order_id: b.order_id, machine_id: b.machine_id, operator_id: b.operator_id });
  res.status(201).json({ id: row.id, delay_minutes: delayMinutes, message: 'Operator allocated' });
}));

// ─── Shop-floor actions ─────────────────────────────────────────────────────

// POST /api/production/actions — operator starts/ends setup, work, supervision or a delay
router.post('/actions', h(async (req, res) => {
  const b = v.body(req, v.z.object({
    allocation_id: v.id,
    action_type: v.z.enum(ACTION_TYPES),
    notes: v.optStr(2000),
  }));
  const tz = req.user.timezone;
  const now = nowLocal(tz);
  const alloc = await getOwnedAllocation(req, b.allocation_id);
  const order = await db.get('SELECT * FROM orders WHERE id = ? FOR UPDATE', [alloc.order_id]);
  if (!order) throw notFound('Order');
  if (['done', 'cancelled'].includes(order.status) && b.action_type.endsWith('_start')) {
    throw badRequest(`Order is already ${order.status}`);
  }

  await db.run('INSERT INTO operator_actions (allocation_id, action_type, notes, timestamp) VALUES (?, ?, ?, ?)',
    [b.allocation_id, b.action_type, b.notes ?? '', now]);

  if (b.action_type === 'setup_start' || b.action_type === 'working_start') {
    if (!order.actual_start) await db.run('UPDATE orders SET actual_start = ? WHERE id = ?', [now, order.id]);

    // Late start (more than 1 minute): log it and push the plan.
    const lateMinutes = Math.ceil(diffMinutes(now, order.planned_start));
    if (lateMinutes > 1) {
      await db.run(`
        INSERT INTO order_delays (order_id, delay_minutes, reason, reported_by, source, applied)
        VALUES (?, ?, ?, ?, 'operator', 1)`, [order.id, lateMinutes, `Late start (${b.action_type})`, req.user.id]);
      await db.run('UPDATE orders SET planned_start = ? WHERE id = ?', [now, order.id]);
      await propagateDelay(order.id, lateMinutes);
    }
  }

  if (b.action_type === 'working_end') {
    await db.run("UPDATE orders SET actual_end = ?, status = 'done' WHERE id = ?", [now, order.id]);
    broadcast('order:completed', { order_id: order.id });
  }

  if (b.action_type.endsWith('_end')) {
    const phase = b.action_type.replace('_end', '');
    const start = await db.get(`
      SELECT timestamp FROM operator_actions WHERE allocation_id = ? AND action_type = ?
      ORDER BY timestamp DESC, id DESC LIMIT 1`, [b.allocation_id, `${phase}_start`]);
    if (start && phase !== 'delay') {
      const hours = Math.max(0, diffMinutes(now, start.timestamp)) / 60;
      await db.run('UPDATE machines SET total_running_hours = total_running_hours + ? WHERE id = ?', [hours, alloc.machine_id]);
    }
  }

  broadcast('production:action', { allocation_id: b.allocation_id, action_type: b.action_type });
  res.status(201).json({ message: 'Action recorded' });
}));

// POST /api/production/results — report good/scrap quantities
router.post('/results', h(async (req, res) => {
  const b = v.body(req, v.z.object({
    order_id: v.id,
    qty_ok: v.z.coerce.number().int().min(0).default(0),
    qty_fail: v.z.coerce.number().int().min(0).default(0),
    defects: v.z.array(v.z.object({
      reason_id: v.id,
      quantity: v.z.coerce.number().int().min(0),
      notes: v.optStr(2000),
    })).optional(),
  }));
  if (b.qty_ok + b.qty_fail === 0) throw badRequest('Enter a quantity');

  const order = await db.get('SELECT * FROM orders WHERE id = ? FOR UPDATE', [b.order_id]);
  if (!order) throw notFound('Order');
  if (order.status === 'cancelled') throw badRequest('Order is cancelled');
  if (isOnlyOperator(req.user)) {
    const assigned = await db.get('SELECT id FROM machine_allocations WHERE order_id = ? AND operator_id = ? LIMIT 1', [order.id, req.user.id]);
    if (!assigned) throw forbidden('You are not assigned to this order');
  }

  const result = await db.get('INSERT INTO production_results (order_id, operator_id, qty_ok, qty_fail) VALUES (?, ?, ?, ?) RETURNING id',
    [order.id, req.user.id, b.qty_ok, b.qty_fail]);
  for (const d of b.defects || []) {
    if (d.quantity > 0) {
      await db.run('INSERT INTO defect_logs (result_id, reason_id, quantity, notes) VALUES (?, ?, ?, ?)', [result.id, d.reason_id, d.quantity, d.notes ?? '']);
    }
  }

  await deductStock(order.id, b.qty_ok + b.qty_fail, req.user.id, await scannedLot(order.id));
  const lotNumber = await bookFinishedGoods(order, b.qty_ok, req.user.id);

  const total = await db.get('SELECT COALESCE(SUM(qty_ok + qty_fail), 0) AS produced FROM production_results WHERE order_id = ?', [order.id]);
  if (total.produced >= order.quantity && order.status !== 'done') {
    await db.run("UPDATE orders SET status = 'done', actual_end = ? WHERE id = ?", [nowLocal(req.user.timezone), order.id]);
    broadcast('order:completed', { order_id: order.id });
  }

  broadcast('production:results', { order_id: order.id, qty_ok: b.qty_ok, qty_fail: b.qty_fail });
  res.status(201).json({ message: 'Results recorded', lot_number: lotNumber });
}));

// GET /api/production/performance
router.get('/performance', requireRole('area_supervisor', 'administrator'), h(async (req, res) => {
  const byMachine = await db.all(`
    SELECT machine_id, COUNT(*) AS total_orders,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'done' AND actual_end::timestamp <= planned_end::timestamp THEN 1 ELSE 0 END) AS on_time
    FROM orders WHERE status <> 'cancelled'
    GROUP BY machine_id`);
  const byOperator = await db.all('SELECT operator_id, COUNT(*) AS total_allocations FROM machine_allocations GROUP BY operator_id');
  res.json({ byMachine, byOperator });
}));

// GET /api/production/actions/:allocation_id
router.get('/actions/:allocation_id', h(async (req, res) => {
  res.json(await db.all('SELECT * FROM operator_actions WHERE allocation_id = ? ORDER BY timestamp ASC, id ASC',
    [v.paramId(req, 'allocation_id')]));
}));

// GET /api/production/results/:order_id
router.get('/results/:order_id', h(async (req, res) => {
  const results = await db.all('SELECT * FROM production_results WHERE order_id = ? ORDER BY completed_at DESC, id DESC',
    [v.paramId(req, 'order_id')]);
  const totals = results.reduce((acc, r) => ({ ok: acc.ok + r.qty_ok, fail: acc.fail + r.qty_fail }), { ok: 0, fail: 0 });
  res.json({ results, totals });
}));

// GET /api/production/defect-reasons
router.get('/defect-reasons', h(async (req, res) => {
  res.json(await db.all('SELECT * FROM defect_reasons ORDER BY name'));
}));

// POST /api/production/optimize — suggest operator allocations based on skills
router.post('/optimize', requireRole('shift_responsible', 'administrator'), h(async (req, res) => {
  const b = v.body(req, v.z.object({ shift_id: v.id, date: v.optDate }));
  const targetDate = b.date || todayLocal(req.user.timezone);

  const operators = await db.all(`
    SELECT u.id, u.first_name, u.last_name, u.badge_number
    FROM shift_members sm JOIN users u ON sm.user_id = u.id
    WHERE sm.shift_id = ? AND 'operator' = ANY(u.roles) AND u.active = 1`, [b.shift_id]);
  if (!operators.length) throw badRequest('No operators found in this shift');
  const skills = await db.all('SELECT user_id, machine_id FROM operator_skills WHERE user_id = ANY(?::int[])', [operators.map((o) => o.id)]);

  const orders = await db.all(`
    SELECT * FROM orders
    WHERE status IN ('pending','active')
      AND (planned_start::timestamp::date = ?::date OR planned_end::timestamp::date = ?::date)
    ORDER BY planned_start::timestamp ASC`, [targetDate, targetDate]);
  if (!orders.length) throw badRequest('No open orders found for this date');

  const freeAt = new Map(operators.map((o) => [o.id, null]));
  const suggested = [];
  for (const order of orders) {
    const skilled = operators.filter((op) => skills.some((s) => s.user_id === op.id && s.machine_id === order.machine_id));
    if (!skilled.length) {
      suggested.push({ order_id: order.id, product_name: order.product_name, machine_id: order.machine_id, error: 'No operator with a skill for this machine' });
      continue;
    }
    let best = null; let bestFree = Infinity;
    for (const op of skilled) {
      const f = freeAt.get(op.id) ? parseLocal(freeAt.get(op.id)) : 0;
      if (f < bestFree) { bestFree = f; best = op; }
    }
    const orderStart = parseLocal(order.planned_start);
    const orderEnd = parseLocal(order.planned_end);
    const actualStart = Math.max(orderStart, bestFree);
    const actualEnd = actualStart + (orderEnd - orderStart);
    suggested.push({
      order_id: order.id,
      product_name: order.product_name,
      machine_id: order.machine_id,
      operator_id: best.id,
      operator_name: `${best.first_name} ${best.last_name}`,
      planned_start: order.planned_start,
      suggested_start: formatLocal(actualStart),
      suggested_end: formatLocal(actualEnd),
      delay_minutes: Math.max(0, Math.ceil((actualStart - orderStart) / 60000)),
      is_skill_match: true,
    });
    freeAt.set(best.id, formatLocal(actualEnd));
  }
  res.json({ date: targetDate, operators_count: operators.length, orders_count: orders.length, suggested });
}));

module.exports = router;
