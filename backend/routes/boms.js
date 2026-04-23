const express = require('express');
const { itemsDb } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/boms — all BOMs
router.get('/', authenticateToken, (req, res) => {
  const boms = itemsDb.prepare(`
    SELECT b.*, i.item_code as parent_code, i.name as parent_name
    FROM boms b LEFT JOIN items i ON b.parent_item_id = i.id
    ORDER BY b.id DESC
  `).all();
  res.json(boms);
});

// GET /api/boms/:id
router.get('/:id', authenticateToken, (req, res) => {
  const bom = itemsDb.prepare(`
    SELECT b.*, i.item_code as parent_code, i.name as parent_name
    FROM boms b LEFT JOIN items i ON b.parent_item_id = i.id
    WHERE b.id = ?
  `).get(req.params.id);
  if (!bom) return res.status(404).json({ error: 'BOM nu a fost găsit' });

  const positions = itemsDb.prepare(`
    SELECT bp.*, i.item_code, i.name as item_name, r.name as requirement_name
    FROM bom_positions bp
    JOIN items i ON bp.item_id = i.id
    LEFT JOIN requirements r ON bp.requirement_id = r.id
    WHERE bp.bom_id = ?
    ORDER BY bp.position_code ASC
  `).all(bom.id);

  res.json({ ...bom, positions });
});

// POST /api/boms
router.post('/', authenticateToken, requireRole('planner','administrator'), (req, res) => {
  const { parent_item_id, name, description, positions } = req.body;
  if (!name) return res.status(400).json({ error: 'Numele BOM este obligatoriu' });

  const result = itemsDb.prepare('INSERT INTO boms (parent_item_id, name, description) VALUES (?, ?, ?)').run(parent_item_id || null, name, description || '');
  const bomId = result.lastInsertRowid;

  if (positions && Array.isArray(positions)) {
    const stmt = itemsDb.prepare(`
      INSERT INTO bom_positions (bom_id, item_id, position_code, quantity, start_date, finish_date, location, requirement_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    positions.forEach(p => {
      stmt.run(bomId, p.item_id, p.position_code, p.quantity, p.start_date || null, p.finish_date || null, p.location || null, p.requirement_id || null);
    });
  }

  res.status(201).json({ id: bomId, message: 'BOM creat cu succes' });
});

// GET /api/boms/requirements — list all possible requirements
router.get('/requirements', authenticateToken, (req, res) => {
  const requirements = itemsDb.prepare('SELECT * FROM requirements').all();
  res.json(requirements);
});

// POST /api/boms/requirements
router.post('/requirements', authenticateToken, requireRole('administrator'), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Numele este obligatoriu' });
  try {
    const result = itemsDb.prepare('INSERT INTO requirements (name, description) VALUES (?, ?)').run(name, description || '');
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) { res.status(409).json({ error: 'Requirement existent' }); }
});

module.exports = router;
