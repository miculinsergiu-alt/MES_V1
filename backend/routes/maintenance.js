const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// GET /api/maintenance/status — maintenance status for all active machines
router.get('/status', h(async (req, res) => {
  const rows = await db.all(`
    SELECT m.id, m.name, m.total_running_hours,
           mmc.interval_hours, mmc.warning_threshold_hours,
           COALESCE(mmc.last_maintenance_hours, last.hours_at_maintenance, 0) AS last_maintenance_hours,
           last.maintenance_date AS last_maintenance_date
    FROM machines m
    LEFT JOIN machine_maintenance_config mmc ON m.id = mmc.machine_id
    LEFT JOIN LATERAL (
      SELECT hours_at_maintenance, maintenance_date FROM maintenance_logs ml
      WHERE ml.machine_id = m.id ORDER BY ml.id DESC LIMIT 1
    ) last ON TRUE
    WHERE m.active = 1 ORDER BY m.name`);
  res.json(rows.map((s) => {
    const hoursSinceLast = (s.total_running_hours || 0) - (s.last_maintenance_hours || 0);
    const isDue = s.interval_hours ? hoursSinceLast >= s.interval_hours : false;
    const isWarning = s.interval_hours ? hoursSinceLast >= (s.interval_hours - (s.warning_threshold_hours || 0)) : false;
    return { ...s, hoursSinceLast, isDue, isWarning };
  }));
}));

// POST /api/maintenance/config — set/update maintenance interval
router.post('/config', requireRole('administrator', 'area_supervisor'), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    machine_id: v.id,
    interval_hours: v.z.coerce.number().int().positive().max(1000000),
    warning_threshold_hours: v.z.coerce.number().int().min(0).default(50),
  }).refine((x) => x.warning_threshold_hours < x.interval_hours, { message: 'The warning must come before the interval ends', path: ['warning_threshold_hours'] }));
  await db.run(`
    INSERT INTO machine_maintenance_config (machine_id, interval_hours, warning_threshold_hours, last_maintenance_hours)
    VALUES (?, ?, ?, COALESCE((SELECT hours_at_maintenance FROM maintenance_logs WHERE machine_id = ? ORDER BY id DESC LIMIT 1), 0))
    ON CONFLICT (machine_id) DO UPDATE SET interval_hours = EXCLUDED.interval_hours, warning_threshold_hours = EXCLUDED.warning_threshold_hours`,
  [b.machine_id, b.interval_hours, b.warning_threshold_hours, b.machine_id]);
  res.json({ message: 'Config saved' });
}));

// POST /api/maintenance/log — record a maintenance action
router.post('/log', requireRole('administrator', 'area_supervisor'), h(async (req, res) => {
  const b = v.body(req, v.z.object({ machine_id: v.id, notes: v.optStr(5000) }));
  const machine = await db.get('SELECT total_running_hours FROM machines WHERE id = ?', [b.machine_id]);
  if (!machine) throw notFound('Machine');
  await db.run(`
    INSERT INTO maintenance_logs (machine_id, technician_id, hours_at_maintenance, notes) VALUES (?, ?, ?, ?)`,
  [b.machine_id, req.user.id, machine.total_running_hours || 0, b.notes || '']);
  await db.run('UPDATE machine_maintenance_config SET last_maintenance_hours = ? WHERE machine_id = ?',
    [machine.total_running_hours || 0, b.machine_id]);
  res.json({ message: 'Maintenance logged' });
}));

module.exports = router;
