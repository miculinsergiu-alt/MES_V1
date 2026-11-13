const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { addMinutes, diffMinutes } = require('../lib/time');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const PLANNERS = ['planner', 'administrator'];
const MAX_BOM_DEPTH = 20;

// ─── Scheduling helpers ─────────────────────────────────────────────────────

/** Shifts all later open orders on a machine so they start back-to-back from newStartTime. */
async function propagateMachineShift(machineId, afterOrderId, newStartTime) {
  const subsequent = await db.all(`
    SELECT * FROM orders
    WHERE machine_id = ? AND id <> ? AND status IN ('pending','active')
      AND planned_start::timestamp >= (SELECT planned_start::timestamp FROM orders WHERE id = ?)
    ORDER BY planned_start::timestamp ASC, id ASC`, [machineId, afterOrderId, afterOrderId]);
  let lastEnd = newStartTime;
  for (const o of subsequent) {
    const duration = diffMinutes(o.planned_end, o.planned_start);
    const newEnd = addMinutes(lastEnd, duration);
    await db.run('UPDATE orders SET planned_start = ?, planned_end = ? WHERE id = ?', [lastEnd, newEnd, o.id]);
    lastEnd = newEnd;
  }
}

/** Moves the later steps of an order's routing chain to follow chainEnd. */
async function propagateChain(order, chainEnd) {
  const hasChildren = await db.get('SELECT id FROM orders WHERE parent_order_id = ? LIMIT 1', [order.id]);
  if (!order.parent_order_id && !hasChildren) return;
  const rootId = order.parent_order_id || order.id;
  const steps = await db.all(`
    SELECT * FROM orders
    WHERE (parent_order_id = ? OR id = ?) AND routing_sequence > ? AND status IN ('pending','active')
    ORDER BY routing_sequence ASC`, [rootId, rootId, order.routing_sequence]);
  let lastEnd = chainEnd;
  for (const step of steps) {
    const duration = diffMinutes(step.planned_end, step.planned_start);
    const newEnd = addMinutes(lastEnd, duration);
    await db.run('UPDATE orders SET planned_start = ?, planned_end = ? WHERE id = ?', [lastEnd, newEnd, step.id]);
    await propagateMachineShift(step.machine_id, step.id, lastEnd);
    lastEnd = newEnd;
  }
}

/** Extends an order by delayMinutes and pushes everything that depends on it. */
async function propagateDelay(orderId, delayMinutes) {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) return;
  const newEnd = addMinutes(order.planned_end, delayMinutes);
  await db.run('UPDATE orders SET planned_end = ? WHERE id = ?', [newEnd, orderId]);
  await propagateChain(order, newEnd);
  await propagateMachineShift(order.machine_id, orderId, newEnd);
}

/** Earliest time >= fromTime when the machine is free (after its last open order). */
async function getMachineAvailableTime(machineId, fromTime) {
  const latest = await db.get(`
    SELECT planned_end FROM orders
    WHERE machine_id = ? AND status IN ('pending','active') AND planned_end::timestamp > ?::timestamp
    ORDER BY planned_end::timestamp DESC LIMIT 1`, [machineId, fromTime]);
  return latest ? latest.planned_end : fromTime;
}

// ─── MRP: soft allocation of raw materials ─────────────────────────────────

/**
 * Explodes the BOM (recursively through semi-finished items), reserves
 * available raw-material stock for the order and creates purchase
 * recommendations for anything missing.
 */
async function allocateMaterialsForOrder(orderId, bomId, orderQuantity) {
  if (!bomId) return;
  const needs = new Map(); // itemId -> qty

  async function explode(currentBomId, qty, depth, path) {
    if (depth > MAX_BOM_DEPTH || path.has(currentBomId)) {
      throw badRequest('The BOM structure contains a loop or is nested too deeply');
    }
    const positions = await db.all(`
      SELECT bp.item_id, bp.quantity AS bom_quantity, i.type AS item_type
      FROM bom_positions bp JOIN items i ON bp.item_id = i.id
      WHERE bp.bom_id = ?`, [currentBomId]);
    for (const pos of positions) {
      const required = pos.bom_quantity * qty;
      if (pos.item_type === 'raw_material') {
        needs.set(pos.item_id, (needs.get(pos.item_id) || 0) + required);
      } else if (pos.item_type === 'semi_finished') {
        const sub = await db.get('SELECT id FROM boms WHERE parent_item_id = ? ORDER BY id LIMIT 1', [pos.item_id]);
        if (sub) await explode(sub.id, required, depth + 1, new Set([...path, currentBomId]));
      }
    }
  }
  await explode(bomId, orderQuantity, 1, new Set());

  for (const [itemId, required] of needs) {
    if (required <= 0) continue;
    await db.run(`
      INSERT INTO stock_levels (item_id, quantity, allocated_quantity) VALUES (?, 0, 0)
      ON CONFLICT (item_id) DO NOTHING`, [itemId]);
    const stock = await db.get('SELECT quantity, allocated_quantity FROM stock_levels WHERE item_id = ? FOR UPDATE', [itemId]);
    const available = Math.max(0, (stock.quantity || 0) - (stock.allocated_quantity || 0));
    const toAllocate = Math.min(available, required);
    const deficit = required - toAllocate;

    if (toAllocate > 0) {
      await db.run('UPDATE stock_levels SET allocated_quantity = allocated_quantity + ? WHERE item_id = ?', [toAllocate, itemId]);
      await db.run(`
        INSERT INTO order_material_allocations (order_id, item_id, allocated_qty) VALUES (?, ?, ?)
        ON CONFLICT (order_id, item_id) DO UPDATE SET allocated_qty = order_material_allocations.allocated_qty + EXCLUDED.allocated_qty`,
      [orderId, itemId, toAllocate]);
    }
    if (deficit > 0) {
      const exists = await db.get(
        "SELECT id FROM purchase_recommendations WHERE triggering_order_id = ? AND item_id = ? AND status = 'pending'", [orderId, itemId]);
      if (!exists) {
        await db.run('INSERT INTO purchase_recommendations (item_id, recommended_qty, triggering_order_id) VALUES (?, ?, ?)',
          [itemId, deficit, orderId]);
      }
    }
  }
}

async function releaseAllocationsForOrder(orderId) {
  const allocations = await db.all('SELECT * FROM order_material_allocations WHERE order_id = ?', [orderId]);
  for (const a of allocations) {
    await db.run('UPDATE stock_levels SET allocated_quantity = GREATEST(0, allocated_quantity - ?) WHERE item_id = ?',
      [a.allocated_qty, a.item_id]);
  }
  await db.run('DELETE FROM order_material_allocations WHERE order_id = ?', [orderId]);
  await db.run("DELETE FROM purchase_recommendations WHERE triggering_order_id = ? AND status = 'pending'", [orderId]);
}

// ─── Read routes ────────────────────────────────────────────────────────────

// GET /api/orders/delay-reasons
router.get('/delay-reasons', h(async (req, res) => {
  res.json(await db.all('SELECT * FROM delay_reasons ORDER BY name ASC'));
}));

const listQuery = v.z.object({
  machine_id: v.optId,
  status: v.z.enum(['pending', 'active', 'done', 'cancelled']).optional(),
  order_type: v.z.enum(['production', 'maintenance']).optional(),
  date_from: v.optDateTime.or(v.optDate),
  date_to: v.optDateTime.or(v.optDate),
});

// GET /api/orders
router.get('/', h(async (req, res) => {
  const q = v.query(req, listQuery);
  const params = [];
  let sql = 'SELECT * FROM orders WHERE 1=1';
  if (q.machine_id) { sql += ' AND machine_id = ?'; params.push(q.machine_id); }
  if (q.status) { sql += ' AND status = ?'; params.push(q.status); }
  if (q.order_type) { sql += ' AND order_type = ?'; params.push(q.order_type); }
  if (q.date_from) { sql += ' AND planned_start::timestamp >= ?::timestamp'; params.push(q.date_from); }
  if (q.date_to) { sql += ' AND planned_end::timestamp <= ?::timestamp'; params.push(q.date_to); }
  res.json(await db.all(`${sql} ORDER BY planned_start::timestamp ASC, id ASC`, params));
}));

// GET /api/orders/gantt — orders with delays, allocations and operator actions
router.get('/gantt', h(async (req, res) => {
  const q = v.query(req, v.z.object({ date_from: v.optDateTime.or(v.optDate), date_to: v.optDateTime.or(v.optDate) }));
  const params = [];
  let sql = "SELECT * FROM orders WHERE status <> 'cancelled'";
  if (q.date_from && q.date_to) {
    sql += ' AND planned_start::timestamp <= ?::timestamp AND planned_end::timestamp >= ?::timestamp';
    params.push(q.date_to, q.date_from);
  } else {
    if (q.date_from) { sql += ' AND planned_end::timestamp >= ?::timestamp'; params.push(q.date_from); }
    if (q.date_to) { sql += ' AND planned_start::timestamp <= ?::timestamp'; params.push(q.date_to); }
  }
  const orders = await db.all(`${sql} ORDER BY machine_id, planned_start::timestamp ASC`, params);
  if (!orders.length) return res.json([]);

  const ids = orders.map((o) => o.id);
  const delays = await db.all(`
    SELECT od.*, dr.name AS reason_name, dr.category AS reason_category
    FROM order_delays od LEFT JOIN delay_reasons dr ON od.delay_reason_id = dr.id
    WHERE od.order_id = ANY(?::int[]) ORDER BY od.created_at, od.id`, [ids]);
  const allocations = await db.all(
    'SELECT * FROM machine_allocations WHERE order_id = ANY(?::int[]) ORDER BY start_time ASC, id ASC', [ids]);
  const allocIds = allocations.map((a) => a.id);
  const actions = allocIds.length ? await db.all(
    'SELECT * FROM operator_actions WHERE allocation_id = ANY(?::int[]) ORDER BY timestamp ASC, id ASC', [allocIds]) : [];

  res.json(orders.map((order) => {
    const oAllocs = allocations.filter((a) => a.order_id === order.id);
    const oAllocIds = new Set(oAllocs.map((a) => a.id));
    const oActions = actions.filter((a) => oAllocIds.has(a.allocation_id));
    let currentPhase = oAllocs.length ? oAllocs[oAllocs.length - 1].phase : null;
    const last = oActions[oActions.length - 1];
    if (last && last.action_type.endsWith('_start')) currentPhase = last.action_type.replace('_start', '');
    return {
      ...order,
      delays: delays.filter((d) => d.order_id === order.id),
      current_phase: currentPhase,
      allocations: oAllocs,
      actions: oActions,
    };
  }));
}));

// GET /api/orders/:id
router.get('/:id', h(async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [v.paramId(req)]);
  if (!order) throw notFound('Order');
  const delays = await db.all('SELECT * FROM order_delays WHERE order_id = ? ORDER BY created_at, id', [order.id]);
  res.json({ ...order, delays });
}));

// ─── Create ─────────────────────────────────────────────────────────────────

const newOrderSchema = v.z.object({
  machine_id: v.optId,
  product_name: v.optStr(300),
  item_id: v.optId,
  bom_id: v.optId,
  quantity: v.z.coerce.number().int().positive(),
  planned_start: v.dateTime,
  planned_end: v.optDateTime,
  order_type: v.z.enum(['production', 'maintenance']).default('production'),
  is_fixed_time: v.z.preprocess((x) => !!x && x !== '0' && x !== 'false', v.z.boolean()).default(false),
  route_overrides: v.z.array(v.z.preprocess((x) => (x === '' ? null : x), v.z.coerce.number().min(0).nullable())).optional(),
});

// POST /api/orders — create one or more orders (items with a routing are split into one order per step)
router.post('/', requireRole(...PLANNERS), h(async (req, res) => {
  const { orders } = v.body(req, v.z.object({ orders: v.z.array(newOrderSchema).min(1).max(200) }));
  const created = [];

  const insert = (o, machineId, name, start, end, parentId, sequence) => db.get(`
    INSERT INTO orders (machine_id, product_name, item_id, bom_id, quantity, planned_start, planned_end, status, order_type,
                        created_by, parent_order_id, routing_sequence, is_fixed_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?) RETURNING id`,
  [machineId, name, o.item_id ?? null, o.bom_id ?? null, o.quantity, start, end, o.order_type,
    req.user.id, parentId, sequence, o.is_fixed_time ? 1 : 0]);

  for (const o of orders) {
    let productName = o.product_name;
    if (!productName && o.item_id) productName = (await db.get('SELECT name FROM items WHERE id = ?', [o.item_id]))?.name;
    if (!productName) throw badRequest('product_name or item_id is required');

    const route = o.item_id
      ? await db.all('SELECT * FROM item_routes WHERE item_id = ? ORDER BY sequence ASC', [o.item_id])
      : [];

    if (route.length) {
      // Routing mode: one order per step, each starting when the previous step and its machine are free.
      let lastEnd = o.planned_start;
      let rootId = null;
      for (const [i, step] of route.entries()) {
        const start = await getMachineAvailableTime(step.machine_id, lastEnd);
        const override = o.route_overrides?.[i];
        const baseMinutes = override !== undefined && override !== null ? override : (step.process_time_min || 0);
        const minutes = (o.is_fixed_time ? baseMinutes : baseMinutes * o.quantity) || 60;
        const end = addMinutes(start, minutes);
        const name = `${productName} [${i + 1}/${route.length}]`;
        const row = await insert(o, step.machine_id, name, start, end, rootId, step.sequence);
        if (i === 0) {
          rootId = row.id;
          await allocateMaterialsForOrder(row.id, o.bom_id, o.quantity);
        }
        created.push({ id: row.id, machine_id: step.machine_id, product_name: name, item_id: o.item_id ?? null,
          bom_id: o.bom_id ?? null, quantity: o.quantity, planned_start: start, planned_end: end });
        lastEnd = end;
      }
    } else {
      if (!o.machine_id) throw badRequest('machine_id is required for items without a routing');
      const start = await getMachineAvailableTime(o.machine_id, o.planned_start);
      const requested = o.planned_end ? diffMinutes(o.planned_end, o.planned_start) : 0;
      const end = addMinutes(start, requested > 0 ? requested : 60);
      const row = await insert(o, o.machine_id, productName, start, end, null, 0);
      await allocateMaterialsForOrder(row.id, o.bom_id, o.quantity);
      created.push({ id: row.id, machine_id: o.machine_id, product_name: productName, item_id: o.item_id ?? null,
        bom_id: o.bom_id ?? null, quantity: o.quantity, planned_start: start, planned_end: end, order_type: o.order_type });
    }
  }
  res.status(201).json({ created, message: `${created.length} order(s) created` });
}));

// ─── Update / cancel ────────────────────────────────────────────────────────

const updateSchema = v.z.object({
  machine_id: v.optId,
  product_name: v.optStr(300),
  item_id: v.optId,
  bom_id: v.optId,
  quantity: v.z.coerce.number().int().positive().optional(),
  planned_start: v.optDateTime,
  planned_end: v.optDateTime,
  status: v.z.enum(['pending', 'active', 'done', 'cancelled']).optional(),
  order_type: v.z.enum(['production', 'maintenance']).optional(),
});

// PUT /api/orders/:id — edit an order; time changes re-align the plan
router.put('/:id', requireRole(...PLANNERS), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, updateSchema);
  const order = await db.get('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
  if (!order) throw notFound('Order');

  const next = {
    machine_id: b.machine_id ?? order.machine_id,
    product_name: b.product_name || order.product_name,
    item_id: b.item_id !== undefined ? b.item_id : order.item_id,
    bom_id: b.bom_id !== undefined ? b.bom_id : order.bom_id,
    quantity: b.quantity ?? order.quantity,
    planned_start: b.planned_start || order.planned_start,
    planned_end: b.planned_end || order.planned_end,
    status: b.status || order.status,
    order_type: b.order_type || order.order_type,
  };
  if (diffMinutes(next.planned_end, next.planned_start) <= 0) throw badRequest('planned_end must be after planned_start');

  await db.run(`
    UPDATE orders SET machine_id=?, product_name=?, item_id=?, bom_id=?, quantity=?, planned_start=?, planned_end=?, status=?, order_type=?
    WHERE id=?`,
  [next.machine_id, next.product_name, next.item_id, next.bom_id, next.quantity, next.planned_start, next.planned_end,
    next.status, next.order_type, id]);

  // Keep material reservations consistent with the order.
  const isRoot = !order.parent_order_id;
  if (next.status === 'cancelled' && order.status !== 'cancelled') {
    await releaseAllocationsForOrder(id);
  } else if (isRoot && next.status === 'pending'
    && (next.quantity !== order.quantity || next.bom_id !== order.bom_id)) {
    await releaseAllocationsForOrder(id);
    await allocateMaterialsForOrder(id, next.bom_id, next.quantity);
  }

  if (b.planned_start || b.planned_end) {
    await propagateChain({ ...order, ...next }, next.planned_end);
    await propagateMachineShift(next.machine_id, id, next.planned_end);
  }
  res.json({ message: 'Order updated and plan re-aligned' });
}));

// DELETE /api/orders/:id — cancel order and release reserved material
router.delete('/:id', requireRole(...PLANNERS), h(async (req, res) => {
  const id = v.paramId(req);
  const r = await db.run("UPDATE orders SET status = 'cancelled' WHERE id = ?", [id]);
  if (!r.rowCount) throw notFound('Order');
  await releaseAllocationsForOrder(id);
  res.json({ message: 'Order cancelled and reservations released' });
}));

// ─── Delays ─────────────────────────────────────────────────────────────────

// POST /api/orders/:id/delay — log a delay and push the schedule
router.post('/:id/delay', h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object({
    delay_minutes: v.z.coerce.number().int().positive().max(60 * 24 * 30),
    reason: v.optStr(2000),
    delay_reason_id: v.optId,
    corrective_action: v.optStr(2000),
    source: v.z.enum(['operator', 'shift_responsible', 'system']).default('system'),
  }));
  const order = await db.get('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
  if (!order) throw notFound('Order');

  const insertDelay = (applied) => db.run(`
    INSERT INTO order_delays (order_id, delay_minutes, reason, delay_reason_id, corrective_action, reported_by, source, applied)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, b.delay_minutes, b.reason ?? '', b.delay_reason_id ?? null, b.corrective_action ?? '', req.user.id, b.source, applied]);

  // A shift lead reporting a delay the operator already logged must not delay the plan twice.
  if (b.source === 'shift_responsible') {
    const already = await db.get("SELECT id FROM order_delays WHERE order_id = ? AND source = 'operator' LIMIT 1", [id]);
    if (already) {
      await insertDelay(0);
      return res.json({ message: 'Delay recorded (not applied: already logged by the operator)', applied: false });
    }
  }
  await insertDelay(1);
  await propagateDelay(id, b.delay_minutes);
  return res.json({ message: `Delay of ${b.delay_minutes} minutes applied to the plan`, applied: true });
}));

// GET /api/orders/:id/delays
router.get('/:id/delays', h(async (req, res) => {
  res.json(await db.all('SELECT * FROM order_delays WHERE order_id = ? ORDER BY created_at DESC, id DESC', [v.paramId(req)]));
}));

// GET /api/orders/:id/materials — BOM positions with quantities for this order
router.get('/:id/materials', h(async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [v.paramId(req)]);
  if (!order) throw notFound('Order');
  if (!order.bom_id) return res.json([]);
  const positions = await db.all(`
    SELECT bp.id, bp.parent_position_id, bp.node_type, bp.department, bp.level, bp.quantity AS bom_quantity,
           bp.position_code, bp.location, i.item_code, i.name AS item_name, i.uom
    FROM bom_positions bp LEFT JOIN items i ON bp.item_id = i.id
    WHERE bp.bom_id = ?
    ORDER BY bp.level ASC, bp.sort_order ASC, bp.position_code ASC`, [order.bom_id]);
  return res.json(positions.map((p) => ({
    ...p,
    required_quantity: p.node_type === 'component' ? p.bom_quantity * order.quantity : null,
  })));
}));

// GET /api/orders/:id/chain — all orders of the same routing chain
router.get('/:id/chain', h(async (req, res) => {
  const order = await db.get('SELECT id, parent_order_id FROM orders WHERE id = ?', [v.paramId(req)]);
  if (!order) throw notFound('Order');
  const rootId = order.parent_order_id || order.id;
  res.json(await db.all(`
    SELECT o.*, m.name AS machine_name
    FROM orders o LEFT JOIN machines m ON o.machine_id = m.id
    WHERE o.id = ? OR o.parent_order_id = ?
    ORDER BY o.routing_sequence ASC, o.planned_start::timestamp ASC`, [rootId, rootId]));
}));

module.exports = router;
module.exports.propagateDelay = propagateDelay;
module.exports.propagateMachineShift = propagateMachineShift;
