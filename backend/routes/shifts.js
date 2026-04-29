const express = require('express');
const { db } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/shifts — list all shifts with responsible info
router.get('/', authenticateToken, (req, res) => {
  const shifts = db.prepare(`
    SELECT s.*, u.first_name, u.last_name, u.badge_number
    FROM shifts s
    LEFT JOIN users u ON s.shift_responsible_id = u.id
    ORDER BY s.start_time ASC
  `).all();
  res.json(shifts);
});

// GET /api/shifts/:id - detailed shift with members
router.get('/:id', authenticateToken, (req, res) => {
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
  if (!shift) return res.status(404).json({ error: 'Schimbul nu a fost găsit' });

  const members = db.prepare(`
    SELECT u.id, u.first_name, u.last_name, u.badge_number, u.role
    FROM shift_members sm
    JOIN users u ON sm.user_id = u.id
    WHERE sm.shift_id = ?
  `).all(req.params.id);

  res.json({ ...shift, members });
});

// POST /api/shifts - create shift + members
router.post('/', authenticateToken, requireRole('administrator', 'area_supervisor'), (req, res) => {
  const { name, shift_responsible_id, start_time, end_time, members } = req.body;
  if (!name || !shift_responsible_id) return res.status(400).json({ error: 'Numele și Responsabilul sunt obligatorii' });

  const transaction = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO shifts (name, shift_responsible_id, start_time, end_time)
      VALUES (?, ?, ?, ?)
    `).run(name, shift_responsible_id, start_time || '06:00', end_time || '14:00');

    const shiftId = info.lastInsertRowid;
    if (members && Array.isArray(members)) {
      const stmt = db.prepare('INSERT INTO shift_members (shift_id, user_id) VALUES (?, ?)');
      for (const userId of members) {
        stmt.run(shiftId, userId);
      }
    }
    return shiftId;
  });

  try {
    const id = transaction();
    res.status(201).json({ id, message: 'Schimb creat cu succes' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/shifts/:id - update shift + members
router.put('/:id', authenticateToken, requireRole('administrator', 'area_supervisor'), (req, res) => {
  const { name, shift_responsible_id, start_time, end_time, members } = req.body;
  
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE shifts SET name = ?, shift_responsible_id = ?, start_time = ?, end_time = ?
      WHERE id = ?
    `).run(name, shift_responsible_id, start_time, end_time, req.params.id);

    db.prepare('DELETE FROM shift_members WHERE shift_id = ?').run(req.params.id);
    if (members && Array.isArray(members)) {
      const stmt = db.prepare('INSERT INTO shift_members (shift_id, user_id) VALUES (?, ?)');
      for (const userId of members) {
        stmt.run(req.params.id, userId);
      }
    }
  });

  try {
    transaction();
    res.json({ message: 'Schimb actualizat' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/shifts/:id
router.delete('/:id', authenticateToken, requireRole('administrator', 'area_supervisor'), (req, res) => {
  db.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
  res.json({ message: 'Schimb șters' });
});

// ─── SCHEDULE ROUTES ────────────────────────────────────────────────────────

// GET /api/shifts/schedule — get operator schedules
router.get('/schedule', authenticateToken, (req, res) => {
  const { date_from, date_to, machine_id } = req.query;
  let sql = `
    SELECT os.*, u.first_name, u.last_name, u.badge_number, m.name as machine_name, s.name as shift_name
    FROM operator_schedules os
    JOIN users u ON os.user_id = u.id
    JOIN machines m ON os.machine_id = m.id
    JOIN shifts s ON os.shift_id = s.id
    WHERE 1=1
  `;
  const params = [];
  if (date_from) { sql += ' AND os.work_date >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND os.work_date <= ?'; params.push(date_to); }
  if (machine_id) { sql += ' AND os.machine_id = ?'; params.push(machine_id); }
  
  const schedule = db.prepare(sql).all(...params);
  res.json(schedule);
});

// POST /api/shifts/schedule
router.post('/schedule', authenticateToken, requireRole('planner', 'administrator', 'area_supervisor', 'shift_responsible'), (req, res) => {
  const { user_id, machine_id, shift_id, work_date } = req.body;
  if (!user_id || !machine_id || !shift_id || !work_date) {
    return res.status(400).json({ error: 'Toate câmpurile sunt obligatorii' });
  }

  try {
    db.prepare(`
      INSERT INTO operator_schedules (user_id, machine_id, shift_id, work_date)
      VALUES (?, ?, ?, ?)
    `).run(user_id, machine_id, shift_id, work_date);
    res.status(201).json({ message: 'Programare salvată' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Operatorul are deja o programare în acest schimb la această dată' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/shifts/schedule/:id
router.delete('/schedule/:id', authenticateToken, requireRole('planner', 'administrator', 'area_supervisor', 'shift_responsible'), (req, res) => {
  db.prepare('DELETE FROM operator_schedules WHERE id = ?').run(req.params.id);
  res.json({ message: 'Programare ștearsă' });
});

module.exports = router;
