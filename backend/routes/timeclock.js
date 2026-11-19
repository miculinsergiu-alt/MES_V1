/**
 * Time clock (PZE): clock in / out, breaks, corrections by supervisors and a
 * monthly report per employee (with CSV for payroll). Statutory minimum
 * breaks (ArbZG §4: 30 min over 6 h, 45 min over 9 h) are applied when fewer
 * were taken; days over 10 h are flagged. Productive hours from the shop
 * floor (BDE: setup + working phases) are shown next to attendance.
 */
const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest, forbidden } = require('../lib/errors');
const { authenticateToken, requireRole, hasRole } = require('../middleware/auth');
const { nowLocal, diffMinutes, parseLocal } = require('../lib/time');

const router = express.Router();
router.use(authenticateToken);
const MANAGERS = ['administrator', 'area_supervisor', 'shift_responsible', 'accounting'];

/** Statutory minimum break for a working span (minutes). */
const minBreak = (spanMin) => (spanMin > 9 * 60 ? 45 : spanMin > 6 * 60 ? 30 : 0);

function evaluate(e, now) {
  const end = e.clock_out || now;
  const span = Math.max(0, diffMinutes(end, e.clock_in));
  let taken = Number(e.break_minutes) || 0;
  if (e.break_started && !e.clock_out) taken += Math.max(0, diffMinutes(now, e.break_started));
  const applied = Math.max(taken, e.clock_out ? minBreak(span) : 0);
  const worked = Math.max(0, span - applied);
  return { ...e, span_minutes: span, break_taken: taken, break_applied: applied, worked_minutes: worked,
    statutory_break_added: applied > taken, over_10h: worked > 600, open: !e.clock_out };
}

const openEntry = (userId) => db.get('SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL', [userId]);

// GET /api/time/status — own clock state
router.get('/status', h(async (req, res) => {
  const e = await openEntry(req.user.id);
  const now = nowLocal(req.user.timezone);
  res.json({ clocked_in: !!e, on_break: !!e?.break_started, entry: e ? evaluate(e, now) : null });
}));

router.post('/clock-in', h(async (req, res) => {
  if (await openEntry(req.user.id)) throw badRequest('Already clocked in');
  const row = await db.get('INSERT INTO time_entries (user_id, clock_in) VALUES (?, ?) RETURNING *', [req.user.id, nowLocal(req.user.timezone)]);
  res.status(201).json(evaluate(row, row.clock_in));
}));

router.post('/break', h(async (req, res) => {
  const e = await openEntry(req.user.id);
  if (!e) throw badRequest('Not clocked in');
  const now = nowLocal(req.user.timezone);
  if (e.break_started) {
    const mins = Math.max(0, diffMinutes(now, e.break_started));
    await db.run('UPDATE time_entries SET break_minutes = break_minutes + ?, break_started = NULL WHERE id = ?', [mins, e.id]);
  } else {
    await db.run('UPDATE time_entries SET break_started = ? WHERE id = ?', [now, e.id]);
  }
  res.json(evaluate(await db.get('SELECT * FROM time_entries WHERE id = ?', [e.id]), now));
}));

router.post('/clock-out', h(async (req, res) => {
  const e = await openEntry(req.user.id);
  if (!e) throw badRequest('Not clocked in');
  const now = nowLocal(req.user.timezone);
  const extra = e.break_started ? Math.max(0, diffMinutes(now, e.break_started)) : 0;
  const row = await db.get('UPDATE time_entries SET clock_out = ?, break_minutes = break_minutes + ?, break_started = NULL WHERE id = ? RETURNING *', [now, extra, e.id]);
  res.json(evaluate(row, now));
}));

const isManager = (user) => hasRole(user, ...MANAGERS);

// GET /api/time/entries?user_id=&from=&to= — own entries; managers see everyone
router.get('/entries', h(async (req, res) => {
  const q = v.query(req, v.z.object({ user_id: v.optId, from: v.optDate, to: v.optDate }));
  const userId = q.user_id ?? req.user.id;
  if (userId !== req.user.id && !isManager(req.user)) throw forbidden();
  const rows = await db.all(`
    SELECT te.*, u.first_name || ' ' || u.last_name AS user_name FROM time_entries te JOIN users u ON u.id = te.user_id
    WHERE te.user_id = ? AND (?::date IS NULL OR te.clock_in::date >= ?::date) AND (?::date IS NULL OR te.clock_in::date <= ?::date)
    ORDER BY te.clock_in DESC LIMIT 500`, [userId, q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null]);
  const now = nowLocal(req.user.timezone);
  res.json(rows.map((r) => evaluate(r, now)));
}));

const entrySchema = v.z.object({
  user_id: v.id, clock_in: v.dateTime, clock_out: v.optDateTime,
  break_minutes: v.z.coerce.number().int().min(0).max(720).default(0), note: v.z.string().trim().min(3, 'Please give a reason for the correction').max(500),
});
const checkSpan = (b) => {
  if (b.clock_out && parseLocal(b.clock_out) <= parseLocal(b.clock_in)) throw badRequest('Clock-out must be after clock-in');
  if (b.clock_out && diffMinutes(b.clock_out, b.clock_in) > 16 * 60) throw badRequest('An entry cannot be longer than 16 hours');
};

// POST /api/time/entries — manual entry / forgotten clocking (managers, with reason)
router.post('/entries', requireRole(...MANAGERS), h(async (req, res) => {
  const b = v.body(req, entrySchema);
  checkSpan(b);
  if (!b.clock_out && await openEntry(b.user_id)) throw badRequest('The employee is already clocked in');
  const row = await db.get(`INSERT INTO time_entries (user_id, clock_in, clock_out, break_minutes, source, note, corrected_by, corrected_at)
    VALUES (?, ?, ?, ?, 'correction', ?, ?, nova_now()) RETURNING *`, [b.user_id, b.clock_in, b.clock_out ?? null, b.break_minutes, b.note, req.user.id]);
  res.status(201).json(evaluate(row, nowLocal(req.user.timezone)));
}));

// PUT /api/time/entries/:id — correction (the change is in the audit log)
router.put('/entries/:id', requireRole(...MANAGERS), h(async (req, res) => {
  const id = v.paramId(req);
  const e = await db.get('SELECT * FROM time_entries WHERE id = ?', [id]);
  if (!e) throw notFound('Time entry');
  const b = v.body(req, entrySchema.omit({ user_id: true }).partial().extend({ note: v.z.string().trim().min(3, 'Please give a reason for the correction').max(500) }));
  const next = { clock_in: b.clock_in ?? e.clock_in, clock_out: b.clock_out ?? e.clock_out, break_minutes: b.break_minutes ?? e.break_minutes };
  checkSpan(next);
  const row = await db.get(`UPDATE time_entries SET clock_in = ?, clock_out = ?, break_minutes = ?, break_started = CASE WHEN ?::text IS NULL THEN break_started ELSE NULL END,
    note = ?, corrected_by = ?, corrected_at = nova_now() WHERE id = ? RETURNING *`,
  [next.clock_in, next.clock_out, next.break_minutes, next.clock_out, b.note, req.user.id, id]);
  res.json(evaluate(row, nowLocal(req.user.timezone)));
}));

// GET /api/time/report?month=YYYY-MM[&format=csv] — per employee: days, hours, target, overtime, productive (BDE)
router.get('/report', requireRole(...MANAGERS), h(async (req, res) => {
  const q = v.query(req, v.z.object({ month: v.z.string().regex(/^\d{4}-\d{2}$/), format: v.z.enum(['json', 'csv']).default('json') }));
  const from = `${q.month}-01`;
  const company = await db.get('SELECT daily_target_hours FROM companies WHERE id = nova_company_id()');
  const target = Number(company?.daily_target_hours ?? 8);
  const entries = await db.all(`
    SELECT te.*, u.first_name, u.last_name, u.badge_number FROM time_entries te JOIN users u ON u.id = te.user_id
    WHERE te.clock_in::date >= ?::date AND te.clock_in::date < (?::date + interval '1 month') ORDER BY u.last_name, te.clock_in`, [from, from]);
  // Productive time from shop-floor actions (setup + working) per operator
  const actions = await db.all(`
    SELECT ma.operator_id AS user_id, oa.allocation_id, oa.action_type, oa.timestamp
    FROM operator_actions oa JOIN machine_allocations ma ON ma.id = oa.allocation_id
    WHERE oa.timestamp::date >= ?::date AND oa.timestamp::date < (?::date + interval '1 month')
    ORDER BY oa.allocation_id, oa.timestamp, oa.id`, [from, from]);
  const productive = {};
  const open = new Map();
  for (const a of actions) {
    const [phase, edge] = a.action_type.split('_');
    if (!['setup', 'working'].includes(phase)) continue;
    const key = `${a.allocation_id}:${phase}`;
    if (edge === 'start') { open.set(key, a.timestamp); continue; }
    const s = open.get(key);
    if (s) { productive[a.user_id] = (productive[a.user_id] || 0) + Math.max(0, diffMinutes(a.timestamp, s)); open.delete(key); }
  }
  const now = nowLocal(req.user.timezone);
  const byUser = new Map();
  for (const e of entries) {
    const ev = evaluate(e, now);
    const u = byUser.get(e.user_id) || { user_id: e.user_id, name: `${e.first_name} ${e.last_name}`, badge_number: e.badge_number, days: new Set(), worked_minutes: 0, break_minutes: 0, over_10h_days: 0, corrections: 0, open: 0 };
    u.days.add(String(e.clock_in).slice(0, 10));
    u.worked_minutes += ev.worked_minutes;
    u.break_minutes += ev.break_applied;
    if (ev.over_10h) u.over_10h_days += 1;
    if (e.source === 'correction' || e.corrected_by) u.corrections += 1;
    if (ev.open) u.open += 1;
    byUser.set(e.user_id, u);
  }
  const rows = [...byUser.values()].map((u) => {
    const days = u.days.size;
    const hours = Math.round((u.worked_minutes / 60) * 100) / 100;
    const targetHours = Math.round(days * target * 100) / 100;
    const prod = Math.round(((productive[u.user_id] || 0) / 60) * 100) / 100;
    return { user_id: u.user_id, name: u.name, badge_number: u.badge_number, days, hours, target_hours: targetHours,
      overtime_hours: Math.round((hours - targetHours) * 100) / 100, break_hours: Math.round((u.break_minutes / 60) * 100) / 100,
      productive_hours: prod, productivity_percent: hours ? Math.round((prod / hours) * 1000) / 10 : null,
      over_10h_days: u.over_10h_days, corrections: u.corrections, open_entries: u.open };
  });
  if (q.format === 'csv') {
    const de = (n) => String(n ?? '').replace('.', ',');
    const lines = ['Personalnr;Name;Tage;Stunden;Soll;Überstunden;Pausen;Produktiv (BDE);Tage >10h;Korrekturen',
      ...rows.map((r) => [r.badge_number, r.name, r.days, de(r.hours), de(r.target_hours), de(r.overtime_hours), de(r.break_hours), de(r.productive_hours), r.over_10h_days, r.corrections].join(';'))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Arbeitszeit_${q.month}.csv"`);
    return res.send(`﻿${lines.join('\r\n')}\r\n`);
  }
  return res.json({ month: q.month, daily_target_hours: target, rows });
}));

module.exports = router;
module.exports.evaluate = evaluate;
