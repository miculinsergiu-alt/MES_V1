const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// GET /api/machines/areas — active areas with their active machines
router.get('/areas', h(async (req, res) => {
  const areas = await db.all('SELECT * FROM areas WHERE active = 1 ORDER BY id');
  const machines = await db.all('SELECT * FROM machines WHERE active = 1 ORDER BY id');
  res.json(areas.map((a) => ({ ...a, machines: machines.filter((m) => m.area_id === a.id) })));
}));

// GET /api/machines — flat list
router.get('/', h(async (req, res) => {
  res.json(await db.all(`
    SELECT m.*, a.name AS area_name
    FROM machines m JOIN areas a ON m.area_id = a.id
    WHERE m.active = 1 ORDER BY a.name, m.name`));
}));

// GET /api/machines/:id
router.get('/:id', h(async (req, res) => {
  const machine = await db.get(`
    SELECT m.*, a.name AS area_name
    FROM machines m JOIN areas a ON m.area_id = a.id
    WHERE m.id = ?`, [v.paramId(req)]);
  if (!machine) throw notFound('Machine');
  res.json(machine);
}));

const areaSchema = v.z.object({ name: v.str(200), description: v.optStr(2000) });

// POST /api/machines/areas — create area (admin)
router.post('/areas', requireRole('administrator'), h(async (req, res) => {
  const b = v.body(req, areaSchema);
  const row = await db.get('INSERT INTO areas (name, description) VALUES (?, ?) RETURNING id', [b.name, b.description ?? '']);
  res.status(201).json({ id: row.id, message: 'Area created' });
}));

// PUT /api/machines/areas/:id
router.put('/areas/:id', requireRole('administrator'), h(async (req, res) => {
  const b = v.body(req, areaSchema);
  const r = await db.run('UPDATE areas SET name = ?, description = ? WHERE id = ?', [b.name, b.description ?? '', v.paramId(req)]);
  if (!r.rowCount) throw notFound('Area');
  res.json({ message: 'Area updated' });
}));

// DELETE /api/machines/areas/:id — deactivates the area and its machines
// (history such as orders keeps referring to them, so nothing is hard-deleted)
router.delete('/areas/:id', requireRole('administrator'), h(async (req, res) => {
  const id = v.paramId(req);
  const r = await db.run('UPDATE areas SET active = 0 WHERE id = ?', [id]);
  if (!r.rowCount) throw notFound('Area');
  await db.run('UPDATE machines SET active = 0 WHERE area_id = ?', [id]);
  res.json({ message: 'Area deleted' });
}));

const machineSchema = v.z.object({
  area_id: v.id,
  name: v.str(200),
  setup_time_min: v.nonNeg.default(30),
  working_time_min: v.nonNeg.default(480),
  supervision_time_min: v.nonNeg.default(30),
});

// POST /api/machines — create machine (admin)
router.post('/', requireRole('administrator'), h(async (req, res) => {
  const b = v.body(req, machineSchema);
  const row = await db.get(
    'INSERT INTO machines (area_id, name, setup_time_min, working_time_min, supervision_time_min) VALUES (?,?,?,?,?) RETURNING id',
    [b.area_id, b.name, b.setup_time_min, b.working_time_min, b.supervision_time_min],
  );
  res.status(201).json({ id: row.id, message: 'Machine created' });
}));

// PUT /api/machines/:id
router.put('/:id', requireRole('administrator'), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, machineSchema.partial());
  const m = await db.get('SELECT * FROM machines WHERE id = ?', [id]);
  if (!m) throw notFound('Machine');
  await db.run(
    'UPDATE machines SET area_id = ?, name = ?, setup_time_min = ?, working_time_min = ?, supervision_time_min = ? WHERE id = ?',
    [b.area_id ?? m.area_id, b.name ?? m.name, b.setup_time_min ?? m.setup_time_min,
      b.working_time_min ?? m.working_time_min, b.supervision_time_min ?? m.supervision_time_min, id],
  );
  res.json({ message: 'Machine updated' });
}));

// DELETE /api/machines/:id — deactivate
router.delete('/:id', requireRole('administrator'), h(async (req, res) => {
  const r = await db.run('UPDATE machines SET active = 0 WHERE id = ?', [v.paramId(req)]);
  if (!r.rowCount) throw notFound('Machine');
  res.json({ message: 'Machine deactivated' });
}));

module.exports = router;
