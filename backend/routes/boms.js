const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const MAX_DEPTH = 10;
const MAX_NODES = 5000;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loadPositions(bomId) {
  return db.all(`
    SELECT bp.*, i.item_code, i.name AS item_name, i.type AS item_type, i.uom,
           i.acquisition_cost, i.production_cost, r.name AS requirement_name
    FROM bom_positions bp
    LEFT JOIN items i ON bp.item_id = i.id
    LEFT JOIN requirements r ON bp.requirement_id = r.id
    WHERE bp.bom_id = ?
    ORDER BY bp.level ASC, bp.sort_order ASC, bp.position_code ASC`, [bomId]);
}

/** Builds a tree of positions; returns root nodes with `children`. */
async function buildPositionTree(bomId) {
  const all = await loadPositions(bomId);
  const map = new Map(all.map((p) => [p.id, { ...p, children: [] }]));
  const roots = [];
  for (const p of all) {
    const node = map.get(p.id);
    if (p.parent_position_id && map.has(p.parent_position_id)) map.get(p.parent_position_id).children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Flattens a tree with indentation info (for print/export). */
function flattenTree(nodes, depth = 0, result = []) {
  for (const node of nodes) {
    result.push({ ...node, depth, indent: '..'.repeat(depth) });
    if (node.children?.length) flattenTree(node.children, depth + 1, result);
  }
  return result;
}

const nodeSchema = v.z.lazy(() => v.z.object({
  item_id: v.optId,
  position_code: v.optStr(50),
  quantity: v.z.preprocess((x) => (x === '' || x === null || x === undefined ? 1 : x), v.nonNeg),
  start_date: v.optStr(30),
  finish_date: v.optStr(30),
  location: v.optStr(200),
  requirement_id: v.optId,
  department: v.optStr(100),
  node_type: v.z.enum(['department', 'component']).default('component'),
  children: v.z.array(nodeSchema).optional(),
}));

const bomSchema = v.z.object({
  parent_item_id: v.optId,
  name: v.str(300),
  description: v.optStr(5000),
  tree: v.z.array(nodeSchema).optional(),
});

function checkTreeSize(nodes, depth = 1, counter = { n: 0 }) {
  if (depth > MAX_DEPTH) throw badRequest(`BOM is nested deeper than ${MAX_DEPTH} levels`);
  for (const node of nodes) {
    counter.n += 1;
    if (counter.n > MAX_NODES) throw badRequest(`BOM has more than ${MAX_NODES} positions`);
    if (node.children?.length) checkTreeSize(node.children, depth + 1, counter);
  }
}

/**
 * Refuses a BOM that contains its own product, directly or through the BOM of
 * one of its components (A contains B, B's BOM contains A). Such a BOM could
 * never be produced.
 */
async function checkNoCycle(parentItemId, nodes, bomId = null) {
  if (!parentItemId) return;
  const direct = new Set();
  (function collect(list) {
    for (const n of list || []) { if (n.item_id) direct.add(Number(n.item_id)); collect(n.children); }
  })(nodes);
  if (direct.has(Number(parentItemId))) throw badRequest('A BOM cannot contain its own product');
  const seen = new Set();
  let frontier = [...direct];
  for (let depth = 0; frontier.length && depth < MAX_DEPTH * 2; depth += 1) {
    const rows = await db.all(`
      SELECT DISTINCT bp.item_id FROM boms b JOIN bom_positions bp ON bp.bom_id = b.id
      WHERE b.parent_item_id = ANY(?::int[]) AND bp.item_id IS NOT NULL AND (?::int IS NULL OR b.id <> ?::int)`,
    [frontier, bomId, bomId]);
    frontier = [];
    for (const r of rows) {
      const itemId = Number(r.item_id);
      if (itemId === Number(parentItemId)) throw badRequest('A component of this BOM already contains this product in its own BOM (circular BOM)');
      if (!seen.has(itemId)) { seen.add(itemId); frontier.push(itemId); }
    }
  }
}

async function insertPositions(bomId, nodes, parentId = null, level = 1) {
  for (const [idx, node] of nodes.entries()) {
    const row = await db.get(`
      INSERT INTO bom_positions
        (bom_id, item_id, position_code, quantity, start_date, finish_date, location, requirement_id,
         parent_position_id, level, sort_order, department, node_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [bomId, node.item_id ?? null, node.position_code || `${(idx + 1) * 10}`, node.quantity,
      node.start_date || null, node.finish_date || null, node.location || null, node.requirement_id ?? null,
      parentId, level, idx, node.department || null, node.node_type]);
    if (node.children?.length) await insertPositions(bomId, node.children, row.id, level + 1);
  }
}

async function getBomHeader(id) {
  const bom = await db.get(`
    SELECT b.*, i.item_code AS parent_code, i.name AS parent_name, i.type AS parent_type
    FROM boms b LEFT JOIN items i ON b.parent_item_id = i.id
    WHERE b.id = ?`, [id]);
  if (!bom) throw notFound('BOM');
  return bom;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/boms — summary list
router.get('/', h(async (req, res) => {
  res.json(await db.all(`
    SELECT b.*, i.item_code AS parent_code, i.name AS parent_name, i.type AS parent_type,
      (SELECT COUNT(*) FROM bom_positions WHERE bom_id = b.id) AS total_positions,
      (SELECT MAX(level) FROM bom_positions WHERE bom_id = b.id) AS max_level
    FROM boms b LEFT JOIN items i ON b.parent_item_id = i.id
    ORDER BY b.created_at DESC, b.id DESC`));
}));

// GET /api/boms/requirements (must be before /:id)
router.get('/requirements', h(async (req, res) => {
  res.json(await db.all('SELECT * FROM requirements ORDER BY name'));
}));

// GET /api/boms/by-item/:itemId
router.get('/by-item/:itemId', h(async (req, res) => {
  const itemId = v.paramId(req, 'itemId');
  const bom = await db.get('SELECT * FROM boms WHERE parent_item_id = ? ORDER BY id LIMIT 1', [itemId]);
  if (!bom) throw notFound('BOM for this item');
  res.json(bom);
}));

// GET /api/boms/:id — BOM with flat positions list
router.get('/:id', h(async (req, res) => {
  const bom = await getBomHeader(v.paramId(req));
  res.json({ ...bom, positions: await loadPositions(bom.id) });
}));

// GET /api/boms/:id/tree — hierarchical
router.get('/:id/tree', h(async (req, res) => {
  const bom = await getBomHeader(v.paramId(req));
  res.json({ ...bom, tree: await buildPositionTree(bom.id) });
}));

// GET /api/boms/:id/flat — indented list for print/export
router.get('/:id/flat', h(async (req, res) => {
  const bom = await getBomHeader(v.paramId(req));
  res.json({ ...bom, positions: flattenTree(await buildPositionTree(bom.id)) });
}));

// POST /api/boms — create with hierarchical positions
router.post('/', requireRole('planner', 'administrator'), h(async (req, res) => {
  const b = v.body(req, bomSchema);
  if (b.tree) checkTreeSize(b.tree);
  await checkNoCycle(b.parent_item_id, b.tree);
  const row = await db.get('INSERT INTO boms (parent_item_id, name, description) VALUES (?, ?, ?) RETURNING id',
    [b.parent_item_id ?? null, b.name, b.description ?? '']);
  if (b.tree?.length) await insertPositions(row.id, b.tree);
  res.status(201).json({ id: row.id, message: 'BOM created' });
}));

// PUT /api/boms/:id — update (replaces the whole tree)
router.put('/:id', requireRole('planner', 'administrator'), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, bomSchema);
  if (b.tree) checkTreeSize(b.tree);
  await checkNoCycle(b.parent_item_id, b.tree, id);
  const r = await db.run('UPDATE boms SET parent_item_id = ?, name = ?, description = ? WHERE id = ?',
    [b.parent_item_id ?? null, b.name, b.description ?? '', id]);
  if (!r.rowCount) throw notFound('BOM');
  await db.run('DELETE FROM bom_positions WHERE bom_id = ?', [id]);
  if (b.tree?.length) await insertPositions(id, b.tree);
  res.json({ message: 'BOM updated' });
}));

// DELETE /api/boms/:id
router.delete('/:id', requireRole('planner', 'administrator'), h(async (req, res) => {
  const id = v.paramId(req);
  const used = await db.get("SELECT id FROM orders WHERE bom_id = ? AND status IN ('pending','active') LIMIT 1", [id]);
  if (used) throw badRequest('This BOM is used by open production orders and cannot be deleted');
  // Finished/cancelled orders keep their history but lose the BOM link.
  await db.run('UPDATE orders SET bom_id = NULL WHERE bom_id = ?', [id]);
  const r = await db.run('DELETE FROM boms WHERE id = ?', [id]);
  if (!r.rowCount) throw notFound('BOM');
  res.json({ message: 'BOM deleted' });
}));

// POST /api/boms/requirements
router.post('/requirements', requireRole('administrator'), h(async (req, res) => {
  const b = v.body(req, v.z.object({ name: v.str(200), description: v.optStr(2000) }));
  const row = await db.get('INSERT INTO requirements (name, description) VALUES (?, ?) RETURNING id', [b.name, b.description ?? '']);
  res.status(201).json({ id: row.id });
}));

module.exports = router;
