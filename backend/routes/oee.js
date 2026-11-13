const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { diffMinutes, nowLocal, todayLocal } = require('../lib/time');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// GET /api/oee — OEE per machine for one day (default: today)
router.get('/', h(async (req, res) => {
  const q = v.query(req, v.z.object({ date_from: v.optDate, date_to: v.optDate, machine_id: v.optId }));
  const tz = req.user.timezone;
  const targetDate = q.date_from || todayLocal(tz);
  const now = nowLocal(tz);

  const params = [];
  let machineSql = 'SELECT * FROM machines WHERE active = 1';
  if (q.machine_id) { machineSql += ' AND id = ?'; params.push(q.machine_id); }
  const machines = await db.all(`${machineSql} ORDER BY name`, params);

  const orders = await db.all(`
    SELECT o.*, i.production_time_min
    FROM orders o LEFT JOIN items i ON o.item_id = i.id
    WHERE o.status <> 'cancelled' AND o.planned_start::timestamp::date = ?::date`, [targetDate]);
  const orderIds = orders.map((o) => o.id);
  const allocs = orderIds.length ? await db.all(
    "SELECT * FROM machine_allocations WHERE phase = 'working' AND order_id = ANY(?::int[])", [orderIds]) : [];
  const allocIds = allocs.map((a) => a.id);
  const actions = allocIds.length ? await db.all(`
    SELECT allocation_id, action_type, MAX(timestamp) AS ts FROM operator_actions
    WHERE allocation_id = ANY(?::int[]) AND action_type IN ('working_start','working_end')
    GROUP BY allocation_id, action_type`, [allocIds]) : [];
  const results = orderIds.length ? await db.all(
    'SELECT order_id, SUM(qty_ok) AS ok, SUM(qty_fail) AS fail FROM production_results WHERE order_id = ANY(?::int[]) GROUP BY order_id',
    [orderIds]) : [];

  const actionTs = (allocId, type) => actions.find((a) => a.allocation_id === allocId && a.action_type === type)?.ts;
  const resultFor = (orderId) => results.find((r) => r.order_id === orderId) || { ok: 0, fail: 0 };

  const out = [];
  for (const m of machines) {
    const mOrders = orders.filter((o) => o.machine_id === m.id);
    if (!mOrders.length) continue;
    let planned = 0; let operating = 0; let produced = 0; let ok = 0; let ideal = 0;
    for (const o of mOrders) {
      planned += Math.max(0, diffMinutes(o.planned_end, o.planned_start));
      for (const a of allocs.filter((x) => x.order_id === o.id)) {
        const start = actionTs(a.id, 'working_start') || a.start_time;
        const end = actionTs(a.id, 'working_end') || (o.status === 'active' ? now : a.end_time);
        operating += Math.max(0, diffMinutes(end, start));
      }
      const r = resultFor(o.id);
      const orderProduced = (r.ok || 0) + (r.fail || 0);
      produced += orderProduced;
      ok += r.ok || 0;
      if (o.production_time_min) ideal += orderProduced * o.production_time_min;
    }
    const availability = planned > 0 ? operating / planned : 0;
    const performance = operating > 0 ? ideal / operating : 0;
    const quality = produced > 0 ? ok / produced : 0;
    out.push({
      machine_id: m.id,
      machine_name: m.name,
      availability: clamp01(availability),
      performance: clamp01(performance),
      quality: clamp01(quality),
      oee: clamp01(availability * performance * quality),
      metrics: {
        planned_time_min: Math.round(planned),
        operating_time_min: Math.round(operating),
        total_produced: produced,
        total_ok: ok,
      },
    });
  }
  res.json({ date: targetDate, results: out });
}));

module.exports = router;
