const express = require('express');
const router = express.Router();
const { db } = require('../db/init');

// List warehouses
router.get('/warehouses', (req, res) => {
  try {
    const warehouses = db.prepare('SELECT * FROM warehouses').all();
    res.json(warehouses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create warehouse
router.post('/warehouses', (req, res) => {
  const { name, type, description } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO warehouses (name, type, description)
      VALUES (?, ?, ?)
    `).run(name, type, description);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List locations for a warehouse
router.get('/locations/:warehouseId', (req, res) => {
  try {
    const locations = db.prepare('SELECT * FROM warehouse_locations WHERE warehouse_id = ?').all(req.params.warehouseId);
    res.json(locations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create location
router.post('/locations', (req, res) => {
  const { warehouse_id, zone, shelf, bin, barcode } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO warehouse_locations (warehouse_id, zone, shelf, bin, barcode)
      VALUES (?, ?, ?, ?, ?)
    `).run(warehouse_id, zone, shelf, bin, barcode);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scan location
router.get('/locations/scan/:barcode', (req, res) => {
  try {
    const location = db.prepare(`
      SELECT wl.*, w.name as warehouse_name 
      FROM warehouse_locations wl
      JOIN warehouses w ON wl.warehouse_id = w.id
      WHERE wl.barcode = ?
    `).get(req.params.barcode);
    
    if (!location) return res.status(404).json({ error: 'Location not found' });
    
    // Also get stock at this location
    const stock = db.prepare(`
      SELECT il.*, i.name as item_name, i.item_code
      FROM goods_receipt_items gri
      JOIN inventory_lots il ON gri.lot_number = il.lot_number
      JOIN items i ON il.item_id = i.id
      WHERE gri.location_id = ? AND il.quantity > 0
    `).all(location.id);

    res.json({ location, stock });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
