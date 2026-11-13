const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, conflict } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const SCHEDULERS = ['planner', 'administrator', 'area_supervisor', 'shift_responsible'];

// ─── Operator schedule (must be registered before /:id) ─────────────────────

// GET /api/shifts/schedule
router.get('/schedule', h(async (req, res) => {
  const q = v.query(req, v.z.object({ date_from: v.optDate, date_to: v.optDate, machine_id: v.optId }));
  const params = [];
  let sql = `
    SELECT os.*, u.first_name, u.last_name, u.badge_number, m.name AS machine_name, s.name AS shift_name
    FROM operator_schedules os
    JOIN users u ON os.user_id = u.id
    JOIN machines m ON os.machine_id = m.id
    JOIN shifts s ON os.shift_id = s.id
    WHERE 1=1`;
  if (q.date_from) { sql += ' AND os.work_date >= ?'; params.push(q.date_from); }
  if (q.date_to) { sql += ' AND os.work_date <= ?'; params.push(q.date_to); }
  if (q.machine_id) { sql += ' AND os.machine_id = ?'; params.push(q.machine_id); }
  res.json(await db.all(`${sql} ORDER BY os.work_date, s.start_time`, params));
}));

// POST /api/shifts/schedule
router.post('/schedule', requireRole(...SCHEDULERS), h(async (req, res) => {
  const b = v.body(req, v.z.object({ user_id: v.id, machine_id: v.id, shift_id: v.id, work_date: v.date }));
  const row = await db.get(`
    INSERT INTO operator_schedules (user_id, machine_id, shift_id, work_date) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, work_date, shift_id) DO NOTHING RETURNING id`,
  [b.user_id, b.machine_id, b.shift_id, b.work_date]);
  if (!row) throw conflict('This operator is already scheduled in this shift on this date');
  res.status(201).json({ id: row.id, message: 'Schedule saved' });
}));

// DELETE /api/shifts/schedule/:id
router.delete('/schedule/:id', requireRole(...SCHEDULERS), h(async (req, res) => {
  await db.run('DELETE FROM operator_schedules WHERE id = ?', [v.paramId(req)]);
  res.json({ message: 'Schedule deleted' });
}));

// ─── Shifts ─────────────────────────────────────────────────────────────────

// GET /api/shifts — all shifts with responsible person
router.get('/', h(async (req, res) => {
  res.json(await db.all(`
    SELECT s.*, u.first_name, u.last_name, u.badge_number
    FROM shifts s LEFT JOIN users u ON s.shift_responsible_id = u.id
    ORDER BY s.start_time ASC NULLS LAST, s.id`));
}));

// GET /api/shifts/:id — shift with members
router.get('/:id', h(async (req, res) => {
  const id = v.paramId(req);
  const shift = await db.get('SELECT * FROM shifts WHERE id = ?', [id]);
  if (!shift) throw notFound('Shift');
  const members = await db.all(`
    SELECT u.id, u.first_name, u.last_name, u.badge_number, u.role
    FROM shift_members sm JOIN users u ON sm.user_id = u.id
    WHERE sm.shift_id = ? ORDER BY u.last_name`, [id]);
  res.json({ ...shift, members });
}));

const shiftSchema = v.z.object({
  name: v.str(100),
  shift_responsible_id: v.id,
  start_time: v.time.optional(),
  end_time: v.time.optional(),
  members: v.z.array(v.id).optional(),
});

async function setMembers(shiftId, members) {
  await db.run('DELETE FROM shift_members WHERE shift_id = ?', [shiftId]);
  for (const userId of new Set(members)) {
    await db.run('INSERT INTO shift_members (shift_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [shiftId, userId]);
  }
}

// POST /api/shifts — create shift with members
router.post('/', requireRole('administrator', 'area_supervisor'), h(async (req, res) => {
  const b = v.body(req, shiftSchema);
  const row = await db.get('INSERT INTO shifts (name, shift_responsible_id, start_time, end_time) VALUES (?, ?, ?, ?) RETURNING id',
    [b.name, b.shift_responsible_id, b.start_time || '06:00', b.end_time || '14:00']);
  if (b.members) await setMembers(row.id, b.members);
  res.status(201).json({ id: row.id, message: 'Shift created' });
}));

// PUT /api/shifts/:id — update shift and members
router.put('/:id', requireRole('administrator', 'area_supervisor'), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, shiftSchema.partial());
  const s = await db.get('SELECT * FROM shifts WHERE id = ?', [id]);
  if (!s) throw notFound('Shift');
  await db.run('UPDATE shifts SET name = ?, shift_responsible_id = ?, start_time = ?, end_time = ? WHERE id = ?',
    [b.name ?? s.name, b.shift_responsible_id ?? s.shift_responsible_id, b.start_time ?? s.start_time, b.end_time ?? s.end_time, id]);
  if (b.members) await setMembers(id, b.members);
  res.json({ message: 'Shift updated' });
}));

// DELETE /api/shifts/:id
router.delete('/:id', requireRole('administrator', 'area_supervisor'), h(async (req, res) => {
  const id = v.paramId(req);
  const used = await db.get('SELECT id FROM shift_reports WHERE shift_id = ? LIMIT 1', [id]);
  if (used) throw conflict('This shift has shift reports and cannot be deleted');
  const r = await db.run('DELETE FROM shifts WHERE id = ?', [id]);
  if (!r.rowCount) throw notFound('Shift');
  res.json({ message: 'Shift deleted' });
}));

module.exports = router;
