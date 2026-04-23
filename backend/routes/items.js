const express = require('express');
const { db } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/items — all items
router.get('/', authenticateToken, (req, res) => {
  const { type } = req.query;
  let sql = 'SELECT * FROM items WHERE active = 1';
  const params = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY item_code ASC';
  const items = db.prepare(sql).all(...params);
  res.json(items);
});

// GET /api/items/:id
router.get('/:id', authenticateToken, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Articolul nu a fost găsit' });
  
  const routes = db.prepare('SELECT ir.*, m.name as machine_name FROM item_routes ir JOIN machines m ON ir.machine_id = m.id WHERE ir.item_id = ? ORDER BY ir.sequence').all(item.id);
  res.json({ ...item, routes });
});

// POST /api/items
router.post('/', authenticateToken, requireRole('planner','administrator'), (req, res) => {
  const { item_code, name, type, uom, acquisition_cost, production_cost, production_time_min, routes, sop_url, drawing_url } = req.body;
  if (!item_code || !name || !type) return res.status(400).json({ error: 'Codul, numele și tipul sunt obligatorii' });

  try {
    const result = db.prepare(`
      INSERT INTO items (item_code, name, type, uom, acquisition_cost, production_cost, production_time_min, sop_url, drawing_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item_code, name, type, uom || 'buc', acquisition_cost || 0, production_cost || 0, production_time_min || 0, sop_url || null, drawing_url || null);

    const itemId = result.lastInsertRowid;

    if (routes && Array.isArray(routes)) {
      const stmt = db.prepare('INSERT INTO item_routes (item_id, machine_id, sequence, process_time_min, notes) VALUES (?, ?, ?, ?, ?)');
      routes.forEach((r, i) => stmt.run(itemId, r.machine_id, i + 1, r.process_time_min || 0, r.notes || ''));
    }

    res.status(201).json({ id: itemId, message: 'Articol creat cu succes' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Codul de articol există deja' });
    res.status(500).json({ error: 'Eroare server' });
  }
});

// PUT /api/items/:id
router.put('/:id', authenticateToken, requireRole('planner','administrator'), (req, res) => {
  const { name, type, uom, acquisition_cost, production_cost, production_time_min, routes, sop_url, drawing_url } = req.body;
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Articolul nu a fost găsit' });

  db.prepare(`
    UPDATE items SET name=?, type=?, uom=?, acquisition_cost=?, production_cost=?, production_time_min=?, sop_url=?, drawing_url=? WHERE id=?
  `).run(
    name || item.name, 
    type || item.type, 
    uom || item.uom, 
    acquisition_cost ?? item.acquisition_cost, 
    production_cost ?? item.production_cost, 
    production_time_min ?? item.production_time_min,
    sop_url !== undefined ? sop_url : item.sop_url,
    drawing_url !== undefined ? drawing_url : item.drawing_url,
    req.params.id
  );

  if (routes && Array.isArray(routes)) {
    db.prepare('DELETE FROM item_routes WHERE item_id = ?').run(req.params.id);
    const stmt = db.prepare('INSERT INTO item_routes (item_id, machine_id, sequence, process_time_min, notes) VALUES (?, ?, ?, ?, ?)');
    routes.forEach((r, i) => stmt.run(req.params.id, r.machine_id, i + 1, r.process_time_min || 0, r.notes || ''));
  }

  res.json({ message: 'Articol actualizat' });
});

module.exports = router;
