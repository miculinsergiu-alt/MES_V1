/**
 * Outside processing (Fremdbearbeitung): parts go to a subcontractor for one
 * routing step and come back.
 *
 *  planned -> send   : purchase order (type subcontract) + outgoing delivery note (LL-…)
 *          -> receive: good / scrap quantities, actual cost, the next step can start
 * The supplier's invoice is matched to the purchase order like any other.
 */
const express = require('express');
const PDFDocument = require('pdfkit');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { nextNumber } = require('../lib/numbering');

const router = express.Router();
router.use(authenticateToken);
const EDITORS = ['administrator', 'planner', 'material_planner', 'warehouse_manager', 'area_supervisor'];
router.use(requireRole(...EDITORS, 'shift_responsible', 'accounting'));

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const costOf = (qty, price, min) => round2(Math.max(Number(qty) * Number(price), Number(min) || 0));

const SELECT = `
  SELECT j.*, s.name AS supplier_name, o.product_name, o.status AS order_status, i.item_code, i.name AS item_name, i.uom,
         po.po_number
  FROM subcontract_jobs j
  JOIN suppliers s ON s.id = j.supplier_id
  JOIN orders o ON o.id = j.order_id
  LEFT JOIN items i ON i.id = j.item_id
  LEFT JOIN purchase_orders po ON po.id = j.po_id`;

const withCost = (j) => j && ({ ...j, planned_cost: costOf(j.quantity, j.price_per_unit, j.min_charge) });

// GET /api/subcontracting?status=planned|sent|received&order_id=
router.get('/', h(async (req, res) => {
  const q = v.query(req, v.z.object({ status: v.z.enum(['planned', 'sent', 'received', 'cancelled', 'open']).optional(), order_id: v.optId }));
  const where = []; const params = [];
  if (q.status === 'open') where.push("j.status IN ('planned','sent')");
  else if (q.status) { where.push('j.status = ?'); params.push(q.status); }
  if (q.order_id) { where.push('j.order_id = ?'); params.push(q.order_id); }
  const rows = await db.all(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE j.status WHEN 'sent' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, j.planned_send, j.id`, params);
  res.json(rows.map(withCost));
}));

const getJob = async (id) => withCost(await db.get(`${SELECT} WHERE j.id = ?`, [id]));

router.get('/:id', h(async (req, res) => {
  const job = await getJob(v.paramId(req));
  if (!job) throw notFound('Subcontract job');
  res.json(job);
}));

// POST /api/subcontracting/:id/send { quantity?, expected_return?, notes? }
router.post('/:id/send', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object({ quantity: v.z.coerce.number().positive().optional(), expected_return: v.optDate, notes: v.optStr(1000) }));
  const job = await db.get('SELECT * FROM subcontract_jobs WHERE id = ? FOR UPDATE', [id]);
  if (!job) throw notFound('Subcontract job');
  if (job.status !== 'planned') throw badRequest('Only planned jobs can be sent');
  const qty = b.quantity ?? Number(job.quantity);
  const expected = b.expected_return ?? (job.planned_return ? String(job.planned_return).slice(0, 10) : null);

  // Purchase order for the service, so the subcontractor's invoice can be matched.
  const po = await db.get(
    "INSERT INTO purchase_orders (po_number, supplier_id, expected_date, created_by, po_type) VALUES (?, ?, ?, ?, 'subcontract') RETURNING id, po_number",
    [await nextNumber('purchase_order'), job.supplier_id, expected, req.user.id],
  );
  if (job.item_id) {
    const unit = qty ? costOf(qty, job.price_per_unit, job.min_charge) / qty : Number(job.price_per_unit);
    await db.run('INSERT INTO purchase_order_items (po_id, item_id, quantity_ordered, unit_price) VALUES (?, ?, ?, ?)', [po.id, job.item_id, qty, round2(unit * 10000) / 10000]);
  }
  const ll = await nextNumber('subcontract_delivery');
  await db.run(`
    UPDATE subcontract_jobs SET status = 'sent', po_id = ?, delivery_note_number = ?, sent_quantity = ?, sent_at = nova_now(),
      planned_return = COALESCE(?, planned_return), notes = COALESCE(?, notes) WHERE id = ?`,
  [po.id, ll, qty, expected, b.notes ?? null, id]);
  res.json(await getJob(id));
}));

// POST /api/subcontracting/:id/receive { qty_ok, qty_fail?, actual_cost? }
router.post('/:id/receive', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object({
    qty_ok: v.z.coerce.number().min(0), qty_fail: v.z.coerce.number().min(0).default(0),
    actual_cost: v.z.coerce.number().min(0).optional(), notes: v.optStr(1000),
  }));
  const job = await db.get('SELECT * FROM subcontract_jobs WHERE id = ? FOR UPDATE', [id]);
  if (!job) throw notFound('Subcontract job');
  if (job.status !== 'sent') throw badRequest('Only sent jobs can be received');
  const total = b.qty_ok + b.qty_fail;
  if (total > Number(job.sent_quantity) + 1e-9) throw badRequest('More parts received than were sent');
  const cost = b.actual_cost ?? costOf(job.sent_quantity, job.price_per_unit, job.min_charge);
  await db.run(`
    UPDATE subcontract_jobs SET status = 'received', received_ok = ?, received_fail = ?, received_at = nova_now(), actual_cost = ?,
      notes = COALESCE(?, notes) WHERE id = ?`, [b.qty_ok, b.qty_fail, cost, b.notes ?? null, id]);
  if (job.po_id) {
    await db.run("UPDATE purchase_orders SET status = 'received' WHERE id = ?", [job.po_id]);
    await db.run('UPDATE purchase_order_items SET quantity_received = ? WHERE po_id = ?', [total, job.po_id]);
  }
  res.json(await getJob(id));
}));

// POST /api/subcontracting/:id/cancel
router.post('/:id/cancel', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const job = await db.get('SELECT status, po_id FROM subcontract_jobs WHERE id = ?', [id]);
  if (!job) throw notFound('Subcontract job');
  if (job.status === 'received') throw badRequest('Received jobs cannot be cancelled');
  await db.run("UPDATE subcontract_jobs SET status = 'cancelled' WHERE id = ?", [id]);
  if (job.po_id) await db.run("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?", [job.po_id]);
  res.json(await getJob(id));
}));

// GET /api/subcontracting/:id/delivery-note.pdf — Lieferschein Lohnbearbeitung
router.get('/:id/delivery-note.pdf', h(async (req, res) => {
  const job = await getJob(v.paramId(req));
  if (!job) throw notFound('Subcontract job');
  if (!job.delivery_note_number) throw badRequest('The job has not been sent yet');
  const company = await db.get('SELECT name, legal_name, street, postal_code, city FROM companies WHERE id = ?', [req.user.company_id]);
  const supplier = await db.get('SELECT * FROM suppliers WHERE id = ?', [job.supplier_id]);
  const material = await db.all(`
    SELECT DISTINCT il.lot_number, i.item_code FROM order_material_lots oml
    JOIN inventory_lots il ON il.id = oml.lot_id JOIN items i ON i.id = il.item_id WHERE oml.order_id = ?`, [job.order_id]);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', r));
  doc.fontSize(9).fillColor('#555').text([company?.legal_name || company?.name, company?.street, [company?.postal_code, company?.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '));
  doc.moveDown(2).fillColor('#000').fontSize(11).text(supplier?.name || job.supplier_name);
  for (const k of ['street', 'address']) if (supplier?.[k]) doc.text(supplier[k]);
  if (supplier?.postal_code || supplier?.city) doc.text([supplier.postal_code, supplier.city].filter(Boolean).join(' '));
  doc.moveDown(2).fontSize(18).text('Lieferschein Lohnbearbeitung');
  doc.fontSize(10).text(`Nr. ${job.delivery_note_number}   ·   Datum ${String(job.sent_at || '').slice(0, 10)}   ·   Bestellung ${job.po_number || '-'}`);
  doc.moveDown(1.5).fontSize(11);
  doc.text(`Artikel: ${[job.item_code, job.item_name].filter(Boolean).join(' · ') || job.product_name}`);
  doc.text(`Menge: ${Number(job.sent_quantity)} ${job.uom || 'Stk'}`);
  doc.text(`Bearbeitung: ${job.description}`);
  doc.text(`Fertigungsauftrag: #${job.order_id}`);
  if (job.planned_return) doc.text(`Rücklieferung bis: ${String(job.planned_return).slice(0, 10)}`);
  if (material.length) doc.text(`Material-Chargen: ${material.map((m) => `${m.item_code} ${m.lot_number}`).join(', ')}`);
  if (job.notes) doc.moveDown().text(`Hinweis: ${job.notes}`);
  doc.moveDown(3).fontSize(9).fillColor('#555').text('Beistellung zur Lohnbearbeitung, kein Verkauf. Bitte Lieferschein-Nr. bei Rücklieferung und Rechnung angeben.');
  doc.moveDown(4).fillColor('#000').text('Empfangen: ______________________   Datum: ___________');
  doc.end();
  await done;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${job.delivery_note_number}.pdf"`);
  res.send(Buffer.concat(chunks));
}));

module.exports = router;
module.exports.costOf = costOf;
