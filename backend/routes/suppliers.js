const express = require('express');
const router = express.Router();
const { db } = require('../db/init');

// List all suppliers with their items
router.get('/', (req, res) => {
  try {
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all();
    const items = db.prepare(`
      SELECT its.*, i.item_code, i.name as item_name 
      FROM item_suppliers its
      JOIN items i ON its.item_id = i.id
    `).all();
    
    suppliers.forEach(s => {
      s.items = items.filter(i => i.supplier_id === s.id);
    });
    
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create supplier
router.post('/', (req, res) => {
  const { name, contact_person, email, phone, address } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO suppliers (name, contact_person, email, phone, address)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, contact_person, email, phone, address);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update supplier
router.put('/:id', (req, res) => {
  const { name, contact_person, email, phone, address, active } = req.body;
  try {
    db.prepare(`
      UPDATE suppliers 
      SET name = ?, contact_person = ?, email = ?, phone = ?, address = ?, active = ?
      WHERE id = ?
    `).run(name, contact_person, email, phone, address, active, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Item-Supplier relationships
router.get('/item/:itemId', (req, res) => {
  try {
    const relationships = db.prepare(`
      SELECT its.*, s.name as supplier_name 
      FROM item_suppliers its
      JOIN suppliers s ON its.supplier_id = s.id
      WHERE its.item_id = ?
    `).all(req.params.itemId);
    res.json(relationships);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/item', (req, res) => {
  const { item_id, supplier_id, purchase_price, currency, lead_time_days, last_negotiation_date, is_primary } = req.body;
  try {
    const result = db.prepare(`
      INSERT OR REPLACE INTO item_suppliers 
      (item_id, supplier_id, purchase_price, currency, lead_time_days, last_negotiation_date, is_primary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(item_id, supplier_id, purchase_price, currency || 'RON', lead_time_days, last_negotiation_date, is_primary);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/item/:itemId/:supplierId', (req, res) => {
  try {
    db.prepare('DELETE FROM item_suppliers WHERE item_id = ? AND supplier_id = ?').run(req.params.itemId, req.params.supplierId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
