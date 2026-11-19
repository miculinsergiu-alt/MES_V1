const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { trace } = require('../services/trace');
const certificates = require('../services/certificates');

const router = express.Router();
router.use(authenticateToken);
router.use(requireRole('administrator', 'planner', 'area_supervisor', 'shift_responsible', 'warehouse_manager', 'material_planner', 'sales'));

// GET /api/trace?q=… — find lots by lot number, item, supplier or customer delivery note
router.get('/', h(async (req, res) => {
  const { q } = v.query(req, v.z.object({ q: v.z.string().trim().max(200).optional() }));
  const like = `%${(q || '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  res.json(await db.all(`
    SELECT il.id, il.lot_number, il.quantity, il.source_type, il.production_order_id, il.created_at,
           i.item_code, i.name AS item_name, i.uom
    FROM inventory_lots il JOIN items i ON i.id = il.item_id
    WHERE ? = '%%' OR il.lot_number ILIKE ? OR i.item_code ILIKE ? OR i.name ILIKE ?
       OR EXISTS (SELECT 1 FROM stock_transactions st JOIN sales_documents sd ON st.reference_type = 'delivery' AND sd.id = st.reference_id
                  WHERE st.lot_id = il.id AND (sd.number ILIKE ? OR sd.customer_name ILIKE ?))
    ORDER BY il.created_at DESC, il.id DESC
    LIMIT 100`, [like, like, like, like, like, like]));
}));

// GET /api/trace/delivery/:id/certificates[.pdf] — material certificates for a delivery note
router.get('/delivery/:id/certificates', h(async (req, res) => {
  const { id } = v.params(req, v.z.object({ id: v.z.coerce.number().int().positive() }));
  const pack = await certificates.forDelivery(id);
  if (!pack) throw notFound('Delivery note');
  res.json(pack);
}));

router.get('/delivery/:id/certificates.pdf', h(async (req, res) => {
  const { id } = v.params(req, v.z.object({ id: v.z.coerce.number().int().positive() }));
  const pack = await certificates.forDelivery(id);
  if (!pack) throw notFound('Delivery note');
  const company = await db.get('SELECT name FROM companies WHERE id = ?', [req.user.company_id]);
  const pdf = await certificates.packPdf(pack, company);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Werkszeugnisse_${String(pack.document.number || id).replace(/[^\w.-]/g, '_')}.pdf"`);
  res.send(pdf);
}));

// GET /api/trace/:lotNumber — backward and forward tree plus affected customers / suppliers
router.get('/:lotNumber', h(async (req, res) => {
  const { lotNumber } = v.params(req, v.z.object({ lotNumber: v.z.string().min(1).max(200) }));
  const result = await trace(lotNumber);
  if (!result) throw notFound('Lot');
  res.json(result);
}));

module.exports = router;
