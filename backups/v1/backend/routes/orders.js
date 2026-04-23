const express = require('express');
const { ordersDb, machinesDb } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// ─── Helper: propagate delay to subsequent orders on same machine ───────────
function propagateDelay(machineId, fromOrderId, delayMinutes) {
  // Get all pending/active orders on this machine after the current one
  const currentOrder = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(fromOrderId);
  if (!currentOrder) return;

  const subsequentOrders = ordersDb.prepare(`
    SELECT * FROM orders
    WHERE machine_id = ? AND id != ? AND status IN ('pending','active')
    AND datetime(planned_start) >= datetime(?)
    ORDER BY planned_start ASC
  `).all(machineId, fromOrderId, currentOrder.planned_start);

  for (const order of subsequentOrders) {
    const newStart = addMinutes(order.planned_start, delayMinutes);
    const newEnd = addMinutes(order.planned_end, delayMinutes);
    ordersDb.prepare('UPDATE orders SET planned_start=?, planned_end=? WHERE id=?').run(newStart, newEnd, order.id);
  }

  // Also shift end of current order
  const newEnd = addMinutes(currentOrder.planned_end, delayMinutes);
  ordersDb.prepare('UPDATE orders SET planned_end=? WHERE id=?').run(newEnd, fromOrderId);
}

function addMinutes(dateStr, minutes) {
  const d = new Date(dateStr);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

// GET /api/orders — all orders (optionally filtered by machine)
router.get('/', authenticateToken, (req, res) => {
  const { machine_id, status, date_from, date_to } = req.query;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (machine_id) { sql += ' AND machine_id = ?'; params.push(machine_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (date_from) { sql += ' AND planned_start >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND planned_end <= ?'; params.push(date_to); }
  sql += ' ORDER BY planned_start ASC';
  const orders = ordersDb.prepare(sql).all(...params);
  res.json(orders);
});

// GET /api/orders/gantt — orders grouped by machine for Gantt display
router.get('/gantt', authenticateToken, (req, res) => {
  const { date_from, date_to } = req.query;
  let sql = "SELECT * FROM orders WHERE status != 'cancelled'";
  const params = [];
  if (date_from) { sql += ' AND planned_end >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND planned_start <= ?'; params.push(date_to); }
  sql += ' ORDER BY machine_id, planned_start ASC';
  const orders = ordersDb.prepare(sql).all(...params);

  // Attach delays
  const result = orders.map(order => {
    const delays = ordersDb.prepare('SELECT * FROM order_delays WHERE order_id = ? ORDER BY created_at').all(order.id);
    return { ...order, delays };
  });
  res.json(result);
});

// GET /api/orders/:id
router.get('/:id', authenticateToken, (req, res) => {
  const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită' });
  const delays = ordersDb.prepare('SELECT * FROM order_delays WHERE order_id = ? ORDER BY created_at').all(order.id);
  res.json({ ...order, delays });
});

// POST /api/orders — create order(s)
router.post('/', authenticateToken, requireRole('planner','administrator'), (req, res) => {
  const { orders } = req.body; // array of orders
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ error: 'Lista de comenzi este obligatorie' });
  }

  const created = [];
  const stmt = ordersDb.prepare(`
    INSERT INTO orders (machine_id, product_name, quantity, planned_start, planned_end, status, created_by)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `);

  for (const o of orders) {
    const { machine_id, product_name, quantity, planned_start, planned_end } = o;
    if (!machine_id || !product_name || !quantity || !planned_start || !planned_end) {
      return res.status(400).json({ error: 'Toate câmpurile comenzii sunt obligatorii' });
    }

    // Check machine exists
    const machine = machinesDb.prepare('SELECT * FROM machines WHERE id = ?').get(machine_id);
    if (!machine) return res.status(404).json({ error: `Utilajul ${machine_id} nu există` });

    const result = stmt.run(machine_id, product_name, quantity, planned_start, planned_end, req.user.id);
    created.push({ id: result.lastInsertRowid, machine_id, product_name, quantity, planned_start, planned_end });
  }

  res.status(201).json({ created, message: `${created.length} comandă/comenzi create cu succes` });
});

// PUT /api/orders/:id
router.put('/:id', authenticateToken, requireRole('planner','administrator'), (req, res) => {
  const { product_name, quantity, planned_start, planned_end, status } = req.body;
  const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită' });

  ordersDb.prepare(`
    UPDATE orders SET product_name=?, quantity=?, planned_start=?, planned_end=?, status=? WHERE id=?
  `).run(
    product_name || order.product_name,
    quantity ?? order.quantity,
    planned_start || order.planned_start,
    planned_end || order.planned_end,
    status || order.status,
    req.params.id
  );
  res.json({ message: 'Comanda actualizată' });
});

// DELETE /api/orders/:id (cancel)
router.delete('/:id', authenticateToken, requireRole('planner','administrator'), (req, res) => {
  const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită' });
  ordersDb.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(req.params.id);
  res.json({ message: 'Comanda anulată' });
});

// POST /api/orders/:id/delay — add delay to order and propagate
router.post('/:id/delay', authenticateToken, (req, res) => {
  const { delay_minutes, reason, source } = req.body;
  if (!delay_minutes || delay_minutes <= 0) return res.status(400).json({ error: 'Minutele de întârziere trebuie să fie pozitive' });

  const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită' });

  // Check for duplicate delay from same source on same order
  if (source === 'shift_responsible') {
    const alreadyLogged = ordersDb.prepare("SELECT id FROM order_delays WHERE order_id = ? AND source = 'operator'").get(order.id);
    if (alreadyLogged) {
      // Log it but mark as not applied (anti-duplicate)
      ordersDb.prepare('INSERT INTO order_delays (order_id, delay_minutes, reason, reported_by, source, applied) VALUES (?,?,?,?,?,0)')
        .run(order.id, delay_minutes, reason || '', req.user.id, source);
      return res.json({ message: 'Delay înregistrat (nu aplicat — deja logat de operator)', applied: false });
    }
  }

  // Insert delay record
  ordersDb.prepare('INSERT INTO order_delays (order_id, delay_minutes, reason, reported_by, source, applied) VALUES (?,?,?,?,?,1)')
    .run(order.id, delay_minutes, reason || '', req.user.id, source || 'system');

  // Propagate to current order + subsequent orders on same machine
  propagateDelay(order.machine_id, order.id, delay_minutes);

  res.json({ message: `Delay de ${delay_minutes} minute aplicat și propagat`, applied: true });
});

// GET /api/orders/:id/delays
router.get('/:id/delays', authenticateToken, (req, res) => {
  const delays = ordersDb.prepare('SELECT * FROM order_delays WHERE order_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(delays);
});

module.exports = router;
