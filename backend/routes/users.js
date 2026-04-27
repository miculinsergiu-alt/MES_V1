const express = require('express');
const bcrypt = require('bcryptjs');
const { usersDb } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/users — list all users (admin, supervisor)
router.get('/', authenticateToken, requireRole('administrator','area_supervisor'), (req, res) => {
  const users = usersDb.prepare('SELECT id, first_name, last_name, badge_number, role, active, created_at FROM users ORDER BY id DESC').all();
  res.json(users);
});

// GET /api/users/operators — list operators (for shift assignment)
router.get('/operators', authenticateToken, (req, res) => {
  const operators = usersDb.prepare("SELECT id, first_name, last_name, badge_number FROM users WHERE role = 'operator' AND active = 1").all();
  res.json(operators);
});

// GET /api/users/by-role/:role
router.get('/by-role/:role', authenticateToken, (req, res) => {
  const users = usersDb.prepare('SELECT id, first_name, last_name, badge_number, role FROM users WHERE role = ? AND active = 1').all(req.params.role);
  res.json(users);
});

// POST /api/users — create user (admin only)
router.post('/', authenticateToken, requireRole('administrator'), (req, res) => {
  const { first_name, last_name, badge_number, role, password } = req.body;
  if (!first_name || !last_name || !badge_number || !role || !password) {
    return res.status(400).json({ error: 'Toate câmpurile sunt obligatorii' });
  }
  const validRoles = ['administrator','planner','area_supervisor','shift_responsible','operator'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Rol invalid' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = usersDb.prepare('INSERT INTO users (first_name, last_name, badge_number, role, password_hash) VALUES (?,?,?,?,?)').run(first_name, last_name, badge_number, role, hash);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Utilizator creat cu succes' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Numărul de legitimație există deja' });
    res.status(500).json({ error: 'Eroare server' });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticateToken, requireRole('administrator'), (req, res) => {
  const { first_name, last_name, role, active, password } = req.body;
  const user = usersDb.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilizatorul nu a fost găsit' });

  const newHash = password ? bcrypt.hashSync(password, 10) : user.password_hash;
  usersDb.prepare('UPDATE users SET first_name=?, last_name=?, role=?, active=?, password_hash=? WHERE id=?')
    .run(first_name || user.first_name, last_name || user.last_name, role || user.role, active !== undefined ? active : user.active, newHash, req.params.id);
  res.json({ message: 'Utilizator actualizat' });
});

// DELETE /api/users/:id (deactivate)
router.delete('/:id', authenticateToken, requireRole('administrator'), (req, res) => {
  usersDb.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Utilizator dezactivat' });
});

// ─── SHIFTS ────────────────────────────────────────────────────────────────

// GET /api/users/shifts
router.get('/shifts/all', authenticateToken, (req, res) => {
  const shifts = usersDb.prepare('SELECT * FROM shifts ORDER BY id').all();
  const result = shifts.map(s => {
    const members = usersDb.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.badge_number, u.role
      FROM shift_members sm JOIN users u ON sm.user_id = u.id
      WHERE sm.shift_id = ?
    `).all(s.id);
    const responsible = usersDb.prepare('SELECT id, first_name, last_name, badge_number FROM users WHERE id = ?').get(s.shift_responsible_id);
    return { ...s, responsible, members };
  });
  res.json(result);
});

// POST /api/users/shifts
router.post('/shifts', authenticateToken, requireRole('area_supervisor','administrator'), (req, res) => {
  const { name, shift_responsible_id, operator_ids } = req.body;
  if (!name || !shift_responsible_id) return res.status(400).json({ error: 'Numele și responsabilul sunt obligatorii' });

  const result = usersDb.prepare('INSERT INTO shifts (name, shift_responsible_id) VALUES (?,?)').run(name, shift_responsible_id);
  const shiftId = result.lastInsertRowid;

  // Add shift responsible
  usersDb.prepare('INSERT OR IGNORE INTO shift_members (shift_id, user_id) VALUES (?,?)').run(shiftId, shift_responsible_id);

  if (operator_ids && Array.isArray(operator_ids)) {
    for (const uid of operator_ids) {
      usersDb.prepare('INSERT OR IGNORE INTO shift_members (shift_id, user_id) VALUES (?,?)').run(shiftId, uid);
    }
  }
  res.status(201).json({ id: shiftId, message: 'Schimb creat cu succes' });
});

// POST /api/users/shifts/:id/move-operator
router.post('/shifts/:id/move-operator', authenticateToken, requireRole('area_supervisor','administrator'), (req, res) => {
  const { user_id, target_shift_id } = req.body;
  usersDb.prepare('DELETE FROM shift_members WHERE user_id = ?').run(user_id);
  usersDb.prepare('INSERT OR IGNORE INTO shift_members (shift_id, user_id) VALUES (?,?)').run(target_shift_id, user_id);
  res.json({ message: 'Operator mutat cu succes' });
});

// DELETE /api/users/shifts/:id
router.delete('/shifts/:id', authenticateToken, requireRole('area_supervisor','administrator'), (req, res) => {
  usersDb.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
  usersDb.prepare('DELETE FROM shift_members WHERE shift_id = ?').run(req.params.id);
  res.json({ message: 'Schimb șters' });
});

// GET /api/users/:id/skills
router.get('/:id/skills', authenticateToken, (req, res) => {
  const skills = usersDb.prepare(`
    SELECT os.*, m.name as machine_name
    FROM operator_skills os
    JOIN machines m ON os.machine_id = m.id
    WHERE os.user_id = ?
  `).all(req.params.id);
  res.json(skills);
});

// POST /api/users/:id/skills — bulk update skills
router.post('/:id/skills', authenticateToken, requireRole('administrator','area_supervisor'), (req, res) => {
  const { skills } = req.body; 
  // skills = [{ machine_id, skill_level, expiration_date }, ...]
  if (!Array.isArray(skills)) return res.status(400).json({ error: 'skills must be an array' });

  const userId = parseInt(req.params.id);

  try {
    usersDb.transaction(() => {
      usersDb.prepare('DELETE FROM operator_skills WHERE user_id = ?').run(userId);
      const stmt = usersDb.prepare('INSERT INTO operator_skills (user_id, machine_id, skill_level, expiration_date) VALUES (?, ?, ?, ?)');
      for (const s of skills) {
        stmt.run(userId, parseInt(s.machine_id), s.skill_level || 'independent', s.expiration_date || null);
      }
    })();
    res.json({ message: 'Skills updated successfully' });
  } catch (err) {
    console.error('[SkillsUpdateError]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
