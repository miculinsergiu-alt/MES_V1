const express = require('express');
const { machinesDb } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/machines/areas — all areas with machines
router.get('/areas', authenticateToken, (req, res) => {
  const areas = machinesDb.prepare('SELECT * FROM areas ORDER BY id').all();
  const result = areas.map(area => {
    const machines = machinesDb.prepare('SELECT * FROM machines WHERE area_id = ? AND active = 1 ORDER BY id').all(area.id);
    return { ...area, machines };
  });
  res.json(result);
});

// GET /api/machines — flat list
router.get('/', authenticateToken, (req, res) => {
  const machines = machinesDb.prepare(`
    SELECT m.*, a.name as area_name
    FROM machines m JOIN areas a ON m.area_id = a.id
    WHERE m.active = 1 ORDER BY a.name, m.name
  `).all();
  res.json(machines);
});

// GET /api/machines/:id
router.get('/:id', authenticateToken, (req, res) => {
  const machine = machinesDb.prepare(`
    SELECT m.*, a.name as area_name
    FROM machines m JOIN areas a ON m.area_id = a.id
    WHERE m.id = ?
  `).get(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Utilajul nu a fost găsit' });
  res.json(machine);
});

// POST /api/machines/areas — create area (admin)
router.post('/areas', authenticateToken, requireRole('administrator'), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Numele ariei este obligatoriu' });
  const result = machinesDb.prepare('INSERT INTO areas (name, description) VALUES (?,?)').run(name, description || '');
  res.status(201).json({ id: result.lastInsertRowid, message: 'Arie creată' });
});

// PUT /api/machines/areas/:id
router.put('/areas/:id', authenticateToken, requireRole('administrator'), (req, res) => {
  const { name, description } = req.body;
  machinesDb.prepare('UPDATE areas SET name=?, description=? WHERE id=?').run(name, description, req.params.id);
  res.json({ message: 'Arie actualizată' });
});

// DELETE /api/machines/areas/:id
router.delete('/areas/:id', authenticateToken, requireRole('administrator'), (req, res) => {
  machinesDb.prepare('UPDATE machines SET active=0 WHERE area_id=?').run(req.params.id);
  machinesDb.prepare('DELETE FROM areas WHERE id=?').run(req.params.id);
  res.json({ message: 'Arie ștearsă' });
});

// POST /api/machines — create machine (admin)
router.post('/', authenticateToken, requireRole('administrator'), (req, res) => {
  const { area_id, name, setup_time_min, working_time_min, supervision_time_min } = req.body;
  if (!area_id || !name) return res.status(400).json({ error: 'Aria și numele sunt obligatorii' });
  const result = machinesDb.prepare('INSERT INTO machines (area_id, name, setup_time_min, working_time_min, supervision_time_min) VALUES (?,?,?,?,?)')
    .run(area_id, name, setup_time_min || 30, working_time_min || 480, supervision_time_min || 30);
  res.status(201).json({ id: result.lastInsertRowid, message: 'Utilaj creat' });
});

// PUT /api/machines/:id
router.put('/:id', authenticateToken, requireRole('administrator'), (req, res) => {
  const { name, setup_time_min, working_time_min, supervision_time_min } = req.body;
  const machine = machinesDb.prepare('SELECT * FROM machines WHERE id = ?').get(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Utilajul nu a fost găsit' });
  machinesDb.prepare('UPDATE machines SET name=?, setup_time_min=?, working_time_min=?, supervision_time_min=? WHERE id=?')
    .run(name || machine.name, setup_time_min ?? machine.setup_time_min, working_time_min ?? machine.working_time_min, supervision_time_min ?? machine.supervision_time_min, req.params.id);
  res.json({ message: 'Utilaj actualizat' });
});

// DELETE /api/machines/:id
router.delete('/:id', authenticateToken, requireRole('administrator'), (req, res) => {
  machinesDb.prepare('UPDATE machines SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Utilaj dezactivat' });
});

module.exports = router;
