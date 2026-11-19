const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const ITEM_TYPES = ['raw_material', 'semi_finished', 'finished_good'];

// GET /api/items — active items, optionally by type
router.get('/', h(async (req, res) => {
  const q = v.query(req, v.z.object({ type: v.z.enum(ITEM_TYPES).optional() }));
  const params = [];
  let sql = 'SELECT * FROM items WHERE active = 1';
  if (q.type) { sql += ' AND type = ?'; params.push(q.type); }
  res.json(await db.all(`${sql} ORDER BY item_code ASC`, params));
}));

// GET /api/items/:id — item with its routing
router.get('/:id', h(async (req, res) => {
  const item = await db.get('SELECT * FROM items WHERE id = ?', [v.paramId(req)]);
  if (!item) throw notFound('Item');
  const routes = await db.all(`
    SELECT ir.*, m.name AS machine_name
    FROM item_routes ir JOIN machines m ON ir.machine_id = m.id
    WHERE ir.item_id = ? ORDER BY ir.sequence`, [item.id]);
  res.json({ ...item, routes });
}));

const routeStep = v.z.object({
  machine_id: v.id,
  process_time_min: v.nonNeg.default(0),
  notes: v.optStr(1000),
});

const itemFields = {
  name: v.str(300),
  type: v.z.enum(ITEM_TYPES),
  uom: v.z.string().trim().min(1).max(20).optional(),
  acquisition_cost: v.nonNeg.optional(),
  production_cost: v.nonNeg.optional(),
  unit_price: v.nonNeg.optional(),
  production_time_min: v.nonNeg.optional(),
  supplier_name: v.optStr(300),
  lead_time_days: v.nonNeg.optional(),
  tax_rate: v.z.coerce.number().refine((x) => [0, 7, 19].includes(x), 'VAT rate must be 0, 7 or 19').optional(),
  sop_url: v.optStr(2000),
  drawing_url: v.optStr(2000),
  requires_certificate: v.flag.optional(),
  routes: v.z.array(routeStep).optional(),
};

async function replaceRoutes(itemId, routes) {
  await db.run('DELETE FROM item_routes WHERE item_id = ?', [itemId]);
  for (const [i, r] of routes.entries()) {
    await db.run(
      'INSERT INTO item_routes (item_id, machine_id, sequence, process_time_min, notes) VALUES (?, ?, ?, ?, ?)',
      [itemId, r.machine_id, i + 1, r.process_time_min, r.notes ?? ''],
    );
  }
}

// POST /api/items
router.post('/', requireRole('planner', 'administrator'), h(async (req, res) => {
  const b = v.body(req, v.z.object({ item_code: v.z.string().trim().min(1).max(100), ...itemFields }));
  const row = await db.get(`
    INSERT INTO items (item_code, name, type, uom, acquisition_cost, production_cost, unit_price, production_time_min, supplier_name, lead_time_days, sop_url, drawing_url, tax_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  [b.item_code, b.name, b.type, b.uom || 'Stk', b.acquisition_cost ?? 0, b.production_cost ?? 0, b.unit_price ?? 0,
    b.production_time_min ?? 0, b.supplier_name || null, b.lead_time_days ?? 0, b.sop_url || null, b.drawing_url || null, b.tax_rate ?? 19]);
  if (b.requires_certificate !== undefined) await db.run('UPDATE items SET requires_certificate = ? WHERE id = ?', [b.requires_certificate, row.id]);
  if (b.routes) await replaceRoutes(row.id, b.routes);
  res.status(201).json({ id: row.id, message: 'Item created' });
}));

// PUT /api/items/:id
router.put('/:id', requireRole('planner', 'administrator'), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object(itemFields).partial());
  const item = await db.get('SELECT * FROM items WHERE id = ?', [id]);
  if (!item) throw notFound('Item');
  await db.run(`
    UPDATE items SET name=?, type=?, uom=?, acquisition_cost=?, production_cost=?, unit_price=?, production_time_min=?,
      supplier_name=?, lead_time_days=?, sop_url=?, drawing_url=?, tax_rate=?
    WHERE id=?`,
  [b.name ?? item.name, b.type ?? item.type, b.uom ?? item.uom,
    b.acquisition_cost ?? item.acquisition_cost, b.production_cost ?? item.production_cost, b.unit_price ?? item.unit_price,
    b.production_time_min ?? item.production_time_min, b.supplier_name !== undefined ? b.supplier_name : item.supplier_name,
    b.lead_time_days ?? item.lead_time_days,
    b.sop_url !== undefined ? b.sop_url : item.sop_url,
    b.drawing_url !== undefined ? b.drawing_url : item.drawing_url, b.tax_rate ?? item.tax_rate, id]);
  if (b.requires_certificate !== undefined) await db.run('UPDATE items SET requires_certificate = ? WHERE id = ?', [b.requires_certificate, id]);
  if (b.routes) await replaceRoutes(id, b.routes);
  res.json({ message: 'Item updated' });
}));

module.exports = router;
