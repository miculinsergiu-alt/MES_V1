const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const WAREHOUSE_ADMINS = ['administrator', 'warehouse_manager', 'material_planner', 'planner'];

// GET /api/warehousing/warehouses
router.get('/warehouses', h(async (req, res) => {
  res.json(await db.all('SELECT * FROM warehouses ORDER BY name'));
}));

// POST /api/warehousing/warehouses
router.post('/warehouses', requireRole(...WAREHOUSE_ADMINS), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    name: v.str(200),
    type: v.z.enum(['central', 'production', 'quarantine', 'shipping']),
    description: v.optStr(2000),
  }));
  const row = await db.get('INSERT INTO warehouses (name, type, description) VALUES (?, ?, ?) RETURNING id',
    [b.name, b.type, b.description ?? null]);
  res.json({ id: row.id });
}));

// GET /api/warehousing/locations/scan/:barcode (before /locations/:warehouseId)
router.get('/locations/scan/:barcode', h(async (req, res) => {
  const { barcode } = v.params(req, v.z.object({ barcode: v.z.string().min(1).max(200) }));
  const location = await db.get(`
    SELECT wl.*, w.name AS warehouse_name
    FROM warehouse_locations wl JOIN warehouses w ON wl.warehouse_id = w.id
    WHERE wl.barcode = ?`, [barcode]);
  if (!location) throw notFound('Location');
  const stock = await db.all(`
    SELECT DISTINCT il.*, i.name AS item_name, i.item_code
    FROM goods_receipt_items gri
    JOIN inventory_lots il ON gri.lot_number = il.lot_number
    JOIN items i ON il.item_id = i.id
    WHERE gri.location_id = ? AND il.quantity > 0`, [location.id]);
  res.json({ location, stock });
}));

// GET /api/warehousing/locations/:warehouseId
router.get('/locations/:warehouseId', h(async (req, res) => {
  res.json(await db.all('SELECT * FROM warehouse_locations WHERE warehouse_id = ? ORDER BY zone, shelf, bin',
    [v.paramId(req, 'warehouseId')]));
}));

// POST /api/warehousing/locations
router.post('/locations', requireRole(...WAREHOUSE_ADMINS), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    warehouse_id: v.id,
    zone: v.optStr(50),
    shelf: v.optStr(50),
    bin: v.optStr(50),
    barcode: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().trim().max(200).nullable().optional()),
  }));
  const row = await db.get(`
    INSERT INTO warehouse_locations (warehouse_id, zone, shelf, bin, barcode) VALUES (?, ?, ?, ?, ?) RETURNING id`,
  [b.warehouse_id, b.zone ?? null, b.shelf ?? null, b.bin ?? null, b.barcode ?? null]);
  res.json({ id: row.id });
}));

module.exports = router;
