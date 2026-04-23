const express = require('express');
const { db } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/maintenance/status — get maintenance status for all machines
router.get('/status', authenticateToken, (req, res) => {
  const status = db.prepare(`
    SELECT m.id, m.name, m.total_running_hours,
           mmc.interval_hours, mmc.last_maintenance_hours, mmc.warning_threshold_hours
    FROM machines m
    LEFT JOIN machine_maintenance_config mmc ON m.id = mmc.machine_id
    WHERE m.active = 1
  `).all();
  
  const result = status.map(s => {
    const hoursSinceLast = s.total_running_hours - (s.last_maintenance_hours || 0);
    const isDue = s.interval_hours ? hoursSinceLast >= s.interval_hours : false;
    const isWarning = s.interval_hours ? hoursSinceLast >= (s.interval_hours - (s.warning_threshold_hours || 0)) : false;
    
    return { ...s, hoursSinceLast, isDue, isWarning };
  });
  
  res.json(result);
});

// POST /api/maintenance/config — set/update maintenance config
router.post('/config', authenticateToken, requireRole('administrator'), (req, res) => {
  const { machine_id, interval_hours, warning_threshold_hours } = req.body;
  if (!machine_id || !interval_hours) return res.status(400).json({ error: 'machine_id and interval_hours are required' });

  const existing = db.prepare('SELECT id FROM machine_maintenance_config WHERE machine_id = ?').get(machine_id);
  if (existing) {
    db.prepare('UPDATE machine_maintenance_config SET interval_hours = ?, warning_threshold_hours = ? WHERE machine_id = ?')
      .run(interval_hours, warning_threshold_hours || 50, machine_id);
  } else {
    db.prepare('INSERT INTO machine_maintenance_config (machine_id, interval_hours, warning_threshold_hours) VALUES (?, ?, ?)')
      .run(machine_id, interval_hours, warning_threshold_hours || 50);
  }
  res.json({ message: 'Config saved' });
});

// POST /api/maintenance/log — record a maintenance action
router.post('/log', authenticateToken, requireRole('administrator', 'area_supervisor'), (req, res) => {
  const { machine_id, notes } = req.body;
  if (!machine_id) return res.status(400).json({ error: 'machine_id is required' });

  const machine = db.prepare('SELECT total_running_hours FROM machines WHERE id = ?').get(machine_id);
  if (!machine) return res.status(404).json({ error: 'Machine not found' });

  db.transaction(() => {
    db.prepare(`
      INSERT INTO maintenance_logs (machine_id, technician_id, hours_at_maintenance, notes)
      VALUES (?, ?, ?, ?)
    `).run(machine_id, req.user.id, machine.total_running_hours, notes || '');

    db.prepare('UPDATE machine_maintenance_config SET last_maintenance_hours = ? WHERE machine_id = ?')
      .run(machine.total_running_hours, machine_id);
  })();

  res.json({ message: 'Maintenance logged' });
});

module.exports = router;
