const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const sales = require('../services/sales');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const READERS = ['administrator', 'sales', 'accounting', 'planner'];
const EDITORS = ['administrator', 'sales', 'accounting'];
const ACCOUNTING = ['administrator', 'accounting'];
const DOC_TYPES = ['quote', 'order', 'delivery', 'invoice', 'credit_note'];

const dec = (max, decimals) => v.z.coerce.number().finite().refine((x) => Math.abs(x) <= max, `Must be at most ${max}`)
  .transform((x) => Number(x.toFixed(decimals)));

const lineSchema = v.z.object({
  item_id: v.optId,
  source_line_id: v.optId, // link to the line of the document this one was created from
  calculation_id: v.optId, // Vorkalkulation the price came from
  description: v.z.preprocess((x) => (x === '' ? undefined : x), v.z.string().trim().max(2000).optional()),
  quantity: dec(1e9, 3).refine((x) => x > 0, 'Quantity must be greater than 0'),
  unit: v.z.preprocess((x) => (x === '' ? undefined : x), v.z.string().trim().max(20).optional()),
  unit_price: v.z.preprocess((x) => (x === '' ? undefined : x), dec(1e10, 4).optional()),
  discount_percent: v.z.preprocess((x) => (x === '' ? 0 : x), v.z.coerce.number().min(0).max(100).default(0)),
  tax_rate: v.z.preprocess((x) => (x === '' ? undefined : x), v.z.coerce.number().refine((x) => [0, 7, 19].includes(x), 'VAT rate must be 0, 7 or 19').optional()),
});

const optText = (max) => v.z.preprocess((x) => (x === '' ? null : x), v.z.string().max(max).nullable().optional());
const optInt = (max) => v.z.preprocess((x) => (x === '' ? null : x), v.z.coerce.number().int().min(0).max(max).nullable().optional());

const headerSchema = {
  document_date: v.optDate,
  service_date: v.optDate,
  service_period_end: v.optDate,
  valid_until: v.optDate,
  delivery_date: v.optDate,
  payment_terms_days: optInt(365),
  skonto_days: optInt(365),
  skonto_percent: v.z.preprocess((x) => (x === '' ? null : x), v.z.coerce.number().min(0).max(20).nullable().optional()),
  customer_reference: optText(200),
  buyer_reference: optText(100),
  intro_text: optText(5000),
  closing_text: optText(5000),
  internal_notes: optText(5000),
};

const createSchema = v.z.object({
  doc_type: v.z.enum(['quote', 'order', 'delivery', 'invoice']),
  customer_id: v.id,
  lines: v.z.array(lineSchema).max(500).default([]),
  ...headerSchema,
});

const updateSchema = v.z.object({
  customer_id: v.optId,
  lines: v.z.array(lineSchema).max(500).optional(),
  ...headerSchema,
});

// GET /api/sales — list documents (without lines)
router.get('/', requireRole(...READERS), h(async (req, res) => {
  const q = v.query(req, v.z.object({
    doc_type: v.z.enum(DOC_TYPES).optional(),
    status: v.z.string().max(30).optional(),
    customer_id: v.optId,
    search: v.z.string().max(100).optional(),
    date_from: v.optDate,
    date_to: v.optDate,
  }));
  const params = [];
  let sql = `SELECT id, doc_type, number, status, customer_id, customer_name, document_date, due_date, net_total, tax_total,
             gross_total, paid_total, credited_total, dunning_level, locked, source_document_id, cancels_document_id, created_at
             FROM sales_documents WHERE 1=1`;
  if (q.doc_type) { sql += ' AND doc_type = ?'; params.push(q.doc_type); }
  if (q.status) { sql += ' AND status = ?'; params.push(q.status); }
  if (q.customer_id) { sql += ' AND customer_id = ?'; params.push(q.customer_id); }
  if (q.date_from) { sql += ' AND document_date >= ?'; params.push(q.date_from); }
  if (q.date_to) { sql += ' AND document_date <= ?'; params.push(q.date_to); }
  if (q.search) {
    const like = `%${q.search.replace(/[%_\\]/g, '\\$&')}%`;
    sql += ' AND (number ILIKE ? OR customer_name ILIKE ? OR customer_reference ILIKE ?)';
    params.push(like, like, like);
  }
  res.json(await db.all(`${sql} ORDER BY document_date DESC, id DESC LIMIT 1000`, params));
}));

// GET /api/sales/open-items — unpaid invoices with days overdue
router.get('/open-items', requireRole(...READERS), h(async (req, res) => {
  const today = (await db.get('SELECT nova_today() AS d')).d;
  const rows = await db.all(`
    SELECT id, number, customer_id, customer_name, document_date, due_date, gross_total, paid_total, credited_total, dunning_level,
           last_dunning_date, status, (gross_total - paid_total - credited_total) AS open_amount
    FROM sales_documents
    WHERE doc_type = 'invoice' AND status IN ('issued','partially_paid')
    ORDER BY due_date ASC, id ASC`);
  res.json(rows.map((r) => {
    const overdue = r.due_date && r.due_date < today
      ? Math.round((Date.parse(today) - Date.parse(r.due_date)) / 86400000) : 0;
    return { ...r, open_amount: Math.round(r.open_amount * 100) / 100, days_overdue: overdue };
  }));
}));

// GET /api/sales/dunning/proposals — overdue invoices due for their next reminder
router.get('/dunning/proposals', requireRole(...ACCOUNTING), h(async (req, res) => {
  res.json(await require('../services/dunning').proposals());
}));

// GET /api/sales/:id — document with lines, payments, files and related documents
router.get('/:id', requireRole(...READERS), h(async (req, res) => {
  const doc = await sales.loadDocument(v.paramId(req));
  const [payments, files, related] = await Promise.all([
    db.all('SELECT * FROM payments WHERE document_id = ? ORDER BY payment_date, id', [doc.id]),
    db.all('SELECT id, kind, filename, mime_type, sha256, created_at FROM document_files WHERE document_id = ? ORDER BY id', [doc.id]),
    db.all(`
      SELECT id, doc_type, number, status, document_date, gross_total FROM sales_documents
      WHERE id IN (?, ?) OR source_document_id = ? OR cancels_document_id = ?
      ORDER BY id`, [doc.source_document_id ?? 0, doc.cancels_document_id ?? 0, doc.id, doc.id]),
  ]);
  // Only offer follow-ups that still have something to put on them.
  const open = (field) => doc.lines.some((l) => Number(l.quantity) > Number(l[field] || 0));
  const conversions = doc.status === 'cancelled' ? [] : (sales.CONVERSIONS[doc.doc_type] || []).filter((target) => {
    if (target === 'delivery') return open('delivered_quantity');
    if (target === 'invoice') return open('invoiced_quantity');
    if (target === 'credit_note') return Number(doc.credited_total || 0) < Number(doc.gross_total);
    return true;
  });
  res.json({ ...doc, payments, files, related: related.filter((r) => r.id !== doc.id), conversions });
}));

// POST /api/sales — create a draft
router.post('/', requireRole(...EDITORS), h(async (req, res) => {
  const b = v.body(req, createSchema);
  res.status(201).json(await sales.saveDraft(null, b, req.user.id));
}));

// PUT /api/sales/:id — edit a draft
router.put('/:id', requireRole(...EDITORS), h(async (req, res) => {
  const b = v.body(req, updateSchema);
  res.json(await sales.saveDraft(v.paramId(req), b, req.user.id));
}));

// DELETE /api/sales/:id — delete a draft
router.delete('/:id', requireRole(...EDITORS), h(async (req, res) => {
  await sales.deleteDraft(v.paramId(req));
  res.json({ message: 'Draft deleted' });
}));

// POST /api/sales/:id/issue — assign number and lock
router.post('/:id/issue', requireRole(...EDITORS), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    create_production: v.z.object({ planned_start: v.dateTime }).optional(),
  }));
  const { archiveDocument } = require('../services/documents');
  const doc = await sales.issue(v.paramId(req), req.user.id, { create_production: b.create_production, archive: archiveDocument });
  res.json(doc);
}));

// POST /api/sales/:id/convert — e.g. quote → order, order → delivery note / invoice, invoice → credit note
router.post('/:id/convert', requireRole(...EDITORS), h(async (req, res) => {
  const { target } = v.body(req, v.z.object({ target: v.z.enum(['order', 'delivery', 'invoice', 'credit_note']) }));
  res.status(201).json(await sales.convert(v.paramId(req), target, req.user.id));
}));

// POST /api/sales/:id/status — quotes: accepted / declined
router.post('/:id/status', requireRole(...EDITORS), h(async (req, res) => {
  const { status } = v.body(req, v.z.object({ status: v.z.enum(['accepted', 'declined']) }));
  const doc = await db.get('SELECT * FROM sales_documents WHERE id = ? FOR UPDATE', [v.paramId(req)]);
  if (!doc) throw notFound('Document');
  if (doc.doc_type !== 'quote' || !doc.locked) throw badRequest('Only issued quotes can be accepted or declined');
  await db.run('UPDATE sales_documents SET status = ? WHERE id = ?', [status, doc.id]);
  res.json(await sales.loadDocument(doc.id));
}));

// GET /api/sales/:id/verify — check that an issued document is unchanged (GoBD)
router.get('/:id/verify', requireRole(...READERS), h(async (req, res) => {
  const doc = await sales.loadDocument(v.paramId(req));
  if (!doc.locked) return res.json({ issued: false });
  const files = await db.all('SELECT id, filename, sha256, content FROM document_files WHERE document_id = ?', [doc.id]);
  const crypto = require('node:crypto');
  const filesOk = files.every((f) => crypto.createHash('sha256').update(f.content).digest('hex') === f.sha256);
  return res.json({ issued: true, content_unchanged: sales.contentHash(doc) === doc.content_hash, files_unchanged: filesOk, content_hash: doc.content_hash });
}));

// ─── Payments ───────────────────────────────────────────────────────────────

// POST /api/sales/:id/payments — record a payment (negative amount = reversal)
router.post('/:id/payments', requireRole(...ACCOUNTING), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    payment_date: v.date,
    amount: dec(1e10, 2).refine((x) => x !== 0, 'Amount must not be 0'),
    method: v.z.enum(['bank_transfer', 'cash', 'direct_debit', 'card', 'other']).default('bank_transfer'),
    reference: optText(200),
    skonto_amount: v.z.preprocess((x) => (x === '' || x === undefined ? 0 : x), dec(1e10, 2).refine((x) => x >= 0, 'Must not be negative')),
    notes: optText(2000),
  }));
  res.status(201).json(await sales.recordPayment(v.paramId(req), b, req.user.id));
}));

// ─── Payment reminders ──────────────────────────────────────────────────────

// GET /api/sales/:id/dunning — reminders sent for an invoice
router.get('/:id/dunning', requireRole(...READERS), h(async (req, res) => {
  res.json(await require('../services/dunning').list(v.paramId(req)));
}));

// POST /api/sales/:id/dunning — send the next reminder level (force: before the usual waiting time)
router.post('/:id/dunning', requireRole(...ACCOUNTING), h(async (req, res) => {
  const { force } = v.body(req, v.z.object({ force: v.z.coerce.boolean().default(false) }));
  res.status(201).json(await require('../services/dunning').createNotice(v.paramId(req), req.user.id, { force }));
}));

// ─── Files (PDF / e-invoice) ────────────────────────────────────────────────

// GET /api/sales/:id/pdf — archived PDF of an issued document, or a live preview of a draft
router.get('/:id/pdf', requireRole(...READERS), h(async (req, res) => {
  const docs = require('../services/documents');
  const { buffer, filename } = await docs.pdfFor(v.paramId(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.end(buffer);
}));

// GET /api/sales/:id/files/:fileId — download an archived file
router.get('/:id/files/:fileId', requireRole(...READERS), h(async (req, res) => {
  const f = await db.get('SELECT * FROM document_files WHERE id = ? AND document_id = ?', [v.paramId(req, 'fileId'), v.paramId(req)]);
  if (!f) throw notFound('File');
  res.setHeader('Content-Type', f.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
  res.end(f.content);
}));

module.exports = router;
