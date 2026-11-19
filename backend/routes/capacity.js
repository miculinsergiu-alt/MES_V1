/**
 * Capacity: machine load per week (planned order minutes vs. available
 * hours) and a delivery date check (capable-to-promise) that simulates the
 * routing on the current schedule without saving anything.
 */
const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { addMinutes, parseLocal, nowLocal } = require('../lib/time');

const router = express.Router();
router.use(authenticateToken);
router.use(requireRole('administrator', 'planner', 'area_supervisor', 'sales', 'material_planner'));

/** Monday (YYYY-MM-DD) of the week of a local date-time string. */
function mondayOf(str) {
  const d = new Date(`${String(str).slice(0, 10)}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// GET /api/capacity/load?from=YYYY-MM-DD&weeks=8
router.get('/load', h(async (req, res) => {
  const q = v.query(req, v.z.object({ from: v.optDate, weeks: v.z.coerce.number().int().min(1).max(26).default(8) }));
  const start = mondayOf(q.from || nowLocal(req.user.timezone));
  const end = addDays(start, q.weeks * 7);
  const weeks = Array.from({ length: q.weeks }, (_, i) => addDays(start, i * 7));
  const machines = await db.all('SELECT id, name, weekly_hours FROM machines ORDER BY name');
  const orders = await db.all(`
    SELECT id, machine_id, planned_start, planned_end FROM orders
    WHERE status IN ('pending','active') AND planned_end::timestamp > ?::timestamp AND planned_start::timestamp < ?::timestamp`, [start, end]);
  const load = {};
  for (const o of orders) {
    // Spread the order's minutes over the weeks it covers.
    let s = parseLocal(o.planned_start); const e = parseLocal(o.planned_end);
    while (s < e) {
      const wk = mondayOf(new Date(s).toISOString());
      const wkEnd = parseLocal(`${addDays(wk, 7)} 00:00`);
      const segEnd = Math.min(e, wkEnd);
      const key = `${o.machine_id}:${wk}`;
      load[key] = (load[key] || 0) + (segEnd - s) / 60000;
      s = segEnd;
    }
  }
  res.json({
    weeks,
    machines: machines.map((m) => ({
      id: m.id, name: m.name, weekly_hours: Number(m.weekly_hours),
      weeks: weeks.map((w) => {
        const hours = Math.round(((load[`${m.id}:${w}`] || 0) / 60) * 10) / 10;
        return { week: w, planned_hours: hours, load_percent: Number(m.weekly_hours) ? Math.round((hours / Number(m.weekly_hours)) * 100) : null };
      }),
    })),
  });
}));

// POST /api/capacity/check { item_id, quantity, start?, desired_date? } — earliest finish on the current schedule
router.post('/check', h(async (req, res) => {
  const b = v.body(req, v.z.object({ item_id: v.id, quantity: v.z.coerce.number().positive().max(1e7), start: v.optDateTime, desired_date: v.optDate }));
  const item = await db.get('SELECT id, item_code, name, lead_time_days FROM items WHERE id = ?', [b.item_id]);
  if (!item) throw notFound('Item');
  const route = await db.all(`
    SELECT ir.*, m.name AS machine_name, s.name AS supplier_name FROM item_routes ir
    LEFT JOIN machines m ON m.id = ir.machine_id LEFT JOIN suppliers s ON s.id = ir.supplier_id
    WHERE ir.item_id = ? ORDER BY ir.sequence`, [item.id]);
  if (!route.length) throw badRequest('The item has no routing');

  // Material: missing raw material delays the start by its lead time.
  let start = b.start || nowLocal(req.user.timezone);
  const bom = await db.get('SELECT id FROM boms WHERE parent_item_id = ? ORDER BY id LIMIT 1', [item.id]);
  const material = [];
  if (bom) {
    const pos = await db.all(`
      SELECT bp.item_id, SUM(bp.quantity) AS qty, i.item_code, i.lead_time_days,
             COALESCE(s.quantity, 0) - COALESCE(s.allocated_quantity, 0) AS free
      FROM bom_positions bp JOIN items i ON i.id = bp.item_id LEFT JOIN stock_levels s ON s.item_id = bp.item_id
      WHERE bp.bom_id = ? AND bp.node_type = 'component' AND bp.item_id IS NOT NULL
      GROUP BY bp.item_id, i.item_code, i.lead_time_days, s.quantity, s.allocated_quantity`, [bom.id]);
    let wait = 0;
    for (const p of pos) {
      const need = Number(p.qty) * b.quantity;
      const short = need > Number(p.free) + 1e-9;
      if (short) wait = Math.max(wait, Number(p.lead_time_days) || 0);
      material.push({ item_code: p.item_code, needed: need, available: Number(p.free), short, lead_time_days: Number(p.lead_time_days) || 0 });
    }
    if (wait) start = addMinutes(start, wait * 24 * 60);
  }

  const steps = [];
  const busyUntil = {}; // simulated extra load per machine within this check
  let t = start;
  for (const s of route) {
    if (s.step_type === 'external') {
      const back = addMinutes(t, Math.max(1, Number(s.external_days) || 0) * 24 * 60);
      steps.push({ sequence: s.sequence, step_type: 'external', supplier_name: s.supplier_name, start: t, end: back });
      t = back;
      continue;
    }
    const latest = await db.get(`
      SELECT planned_end FROM orders WHERE machine_id = ? AND status IN ('pending','active') AND planned_end::timestamp > ?::timestamp
      ORDER BY planned_end::timestamp DESC LIMIT 1`, [s.machine_id, t]);
    let st = latest ? latest.planned_end : t;
    if (busyUntil[s.machine_id] && parseLocal(busyUntil[s.machine_id]) > parseLocal(st)) st = busyUntil[s.machine_id];
    const minutes = (Number(s.setup_time_min) || 0) + (Number(s.process_time_min) || 0) * b.quantity || 60;
    const end = addMinutes(st, minutes);
    busyUntil[s.machine_id] = end;
    steps.push({ sequence: s.sequence, step_type: 'internal', machine_name: s.machine_name, start: st, end, minutes, waits_for_machine: latest ? latest.planned_end > t : false });
    t = end;
  }
  const finish = t;
  const finishDate = String(finish).slice(0, 10);
  res.json({
    item: { id: item.id, item_code: item.item_code, name: item.name }, quantity: b.quantity,
    start, earliest_finish: finish, earliest_delivery_date: finishDate,
    feasible: b.desired_date ? finishDate <= b.desired_date : null,
    days_late: b.desired_date && finishDate > b.desired_date ? Math.ceil((parseLocal(`${finishDate} 00:00`) - parseLocal(`${b.desired_date} 00:00`)) / 86400000) : 0,
    material, steps,
  });
}));

module.exports = router;
