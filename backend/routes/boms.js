const express = require('express');
const { itemsDb } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Builds a tree of positions for a given BOM, recursively.
 * Returns an array of root-level nodes, each with a `children` array.
 */
function buildPositionTree(bomId) {
  const allPositions = itemsDb.prepare(`
    SELECT 
      bp.*,
      i.item_code,
      i.name       AS item_name,
      i.type       AS item_type,
      i.uom,
      i.acquisition_cost,
      i.production_cost,
      r.name       AS requirement_name
    FROM bom_positions bp
    LEFT JOIN items i ON bp.item_id = i.id
    LEFT JOIN requirements r ON bp.requirement_id = r.id
    WHERE bp.bom_id = ?
    ORDER BY bp.level ASC, bp.sort_order ASC, bp.position_code ASC
  `).all(bomId);

  // Build a map for O(1) lookup
  const map = {};
  allPositions.forEach(p => { map[p.id] = { ...p, children: [] }; });

  const roots = [];
  allPositions.forEach(p => {
    if (p.parent_position_id && map[p.parent_position_id]) {
      map[p.parent_position_id].children.push(map[p.id]);
    } else {
      roots.push(map[p.id]);
    }
  });

  return roots;
}

/**
 * Flattens a tree with indentation info (for print/export).
 * Each node gets: indent (number of dots), level, and all position fields.
 */
function flattenTree(nodes, depth = 0, result = []) {
  nodes.forEach(node => {
    result.push({ ...node, depth, indent: '..'.repeat(depth) });
    if (node.children?.length) flattenTree(node.children, depth + 1, result);
  });
  return result;
}

/**
 * Recursively inserts positions from a tree structure.
 * Returns a map of tempId -> real DB id (for building parent references).
 */
function insertPositionsRecursive(stmt, bomId, nodes, parentDbId = null, level = 1, sortBase = 0) {
  nodes.forEach((node, idx) => {
    const sortOrder = sortBase + idx;
    const result = stmt.run(
      bomId,
      node.item_id || null,
      node.position_code || `${(idx + 1) * 10}`,
      node.quantity || 1,
      node.start_date || null,
      node.finish_date || null,
      node.location || null,
      node.requirement_id || null,
      parentDbId,
      level,
      sortOrder,
      node.department || null,
      node.node_type || 'component'
    );
    const newId = result.lastInsertRowid;
    if (node.children?.length) {
      insertPositionsRecursive(stmt, bomId, node.children, newId, level + 1, 0);
    }
  });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/boms — all BOMs (summary list)
router.get('/', authenticateToken, (req, res) => {
  const boms = itemsDb.prepare(`
    SELECT 
      b.*,
      i.item_code AS parent_code,
      i.name      AS parent_name,
      i.type      AS parent_type,
      (SELECT COUNT(*) FROM bom_positions WHERE bom_id = b.id) AS total_positions,
      (SELECT MAX(level) FROM bom_positions WHERE bom_id = b.id) AS max_level
    FROM boms b
    LEFT JOIN items i ON b.parent_item_id = i.id
    ORDER BY b.created_at DESC
  `).all();
  res.json(boms);
});

// GET /api/boms/requirements — list all possible requirements
// IMPORTANT: must be before /:id to avoid route conflict
router.get('/requirements', authenticateToken, (req, res) => {
  const requirements = itemsDb.prepare('SELECT * FROM requirements ORDER BY name').all();
  res.json(requirements);
});

// GET /api/boms/by-item/:itemId — Find BOM by parent item ID (Helper for Editor)
router.get('/by-item/:itemId', authenticateToken, (req, res) => {
  const bom = itemsDb.prepare(`
    SELECT b.* FROM boms b WHERE b.parent_item_id = ? LIMIT 1
  `).get(req.params.itemId);
  
  if (!bom) return res.status(404).json({ error: 'Niciun BOM definit pentru acest articol' });
  res.json(bom);
});

// GET /api/boms/:id — BOM with flat positions list (backward compat)
router.get('/:id', authenticateToken, (req, res) => {
  const bom = itemsDb.prepare(`
    SELECT b.*, i.item_code AS parent_code, i.name AS parent_name, i.type AS parent_type
    FROM boms b
    LEFT JOIN items i ON b.parent_item_id = i.id
    WHERE b.id = ?
  `).get(req.params.id);
  if (!bom) return res.status(404).json({ error: 'BOM nu a fost găsit' });

  const positions = itemsDb.prepare(`
    SELECT 
      bp.*,
      i.item_code,
      i.name        AS item_name,
      i.type        AS item_type,
      i.uom,
      i.acquisition_cost,
      r.name        AS requirement_name
    FROM bom_positions bp
    LEFT JOIN items i ON bp.item_id = i.id
    LEFT JOIN requirements r ON bp.requirement_id = r.id
    WHERE bp.bom_id = ?
    ORDER BY bp.level ASC, bp.sort_order ASC, bp.position_code ASC
  `).all(bom.id);

  res.json({ ...bom, positions });
});

// GET /api/boms/:id/tree — BOM as hierarchical tree (NEW)
router.get('/:id/tree', authenticateToken, (req, res) => {
  const bom = itemsDb.prepare(`
    SELECT b.*, i.item_code AS parent_code, i.name AS parent_name, i.type AS parent_type
    FROM boms b
    LEFT JOIN items i ON b.parent_item_id = i.id
    WHERE b.id = ?
  `).get(req.params.id);
  if (!bom) return res.status(404).json({ error: 'BOM nu a fost găsit' });

  const tree = buildPositionTree(bom.id);
  res.json({ ...bom, tree });
});

// GET /api/boms/:id/flat — BOM as flat indented list (for print/export)
router.get('/:id/flat', authenticateToken, (req, res) => {
  const bom = itemsDb.prepare(`
    SELECT b.*, i.item_code AS parent_code, i.name AS parent_name
    FROM boms b LEFT JOIN items i ON b.parent_item_id = i.id
    WHERE b.id = ?
  `).get(req.params.id);
  if (!bom) return res.status(404).json({ error: 'BOM nu a fost găsit' });

  const tree = buildPositionTree(bom.id);
  const flat = flattenTree(tree);
  res.json({ ...bom, positions: flat });
});

// POST /api/boms — create new BOM with hierarchical positions
router.post('/', authenticateToken, requireRole('planner', 'administrator'), (req, res) => {
  const { parent_item_id, name, description, tree } = req.body;
  if (!name) return res.status(400).json({ error: 'Numele BOM este obligatoriu' });

  const insertBom = itemsDb.transaction(() => {
    const result = itemsDb.prepare(
      'INSERT INTO boms (parent_item_id, name, description) VALUES (?, ?, ?)'
    ).run(parent_item_id || null, name, description || '');
    const bomId = result.lastInsertRowid;

    if (tree && Array.isArray(tree) && tree.length > 0) {
      const stmt = itemsDb.prepare(`
        INSERT INTO bom_positions 
          (bom_id, item_id, position_code, quantity, start_date, finish_date, 
           location, requirement_id, parent_position_id, level, sort_order, department, node_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertPositionsRecursive(stmt, bomId, tree);
    }

    return bomId;
  });

  try {
    const bomId = insertBom();
    res.status(201).json({ id: bomId, message: 'BOM creat cu succes' });
  } catch (err) {
    console.error('Error creating BOM:', err);
    res.status(500).json({ error: 'Eroare la crearea BOM-ului' });
  }
});

// PUT /api/boms/:id — update BOM (replaces entire tree)
router.put('/:id', authenticateToken, requireRole('planner', 'administrator'), (req, res) => {
  const { parent_item_id, name, description, tree } = req.body;
  const bomId = parseInt(req.params.id);

  const existing = itemsDb.prepare('SELECT id FROM boms WHERE id = ?').get(bomId);
  if (!existing) return res.status(404).json({ error: 'BOM nu a fost găsit' });

  const updateBom = itemsDb.transaction(() => {
    itemsDb.prepare(
      'UPDATE boms SET parent_item_id = ?, name = ?, description = ? WHERE id = ?'
    ).run(parent_item_id || null, name, description || '', bomId);

    // Delete all existing positions and re-insert the new tree
    itemsDb.prepare('DELETE FROM bom_positions WHERE bom_id = ?').run(bomId);

    if (tree && Array.isArray(tree) && tree.length > 0) {
      const stmt = itemsDb.prepare(`
        INSERT INTO bom_positions 
          (bom_id, item_id, position_code, quantity, start_date, finish_date, 
           location, requirement_id, parent_position_id, level, sort_order, department, node_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertPositionsRecursive(stmt, bomId, tree);
    }
  });

  try {
    updateBom();
    res.json({ message: 'BOM actualizat cu succes' });
  } catch (err) {
    console.error('Error updating BOM:', err);
    res.status(500).json({ error: 'Eroare la actualizarea BOM-ului' });
  }
});

// DELETE /api/boms/:id
router.delete('/:id', authenticateToken, requireRole('planner', 'administrator'), (req, res) => {
  const existing = itemsDb.prepare('SELECT id FROM boms WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'BOM nu a fost găsit' });

  itemsDb.prepare('DELETE FROM boms WHERE id = ?').run(req.params.id);
  res.json({ message: 'BOM șters' });
});

// POST /api/boms/requirements — create requirement
router.post('/requirements', authenticateToken, requireRole('administrator'), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Numele este obligatoriu' });
  try {
    const result = itemsDb.prepare('INSERT INTO requirements (name, description) VALUES (?, ?)').run(name, description || '');
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(409).json({ error: 'Requirement existent' });
  }
});

module.exports = router;
