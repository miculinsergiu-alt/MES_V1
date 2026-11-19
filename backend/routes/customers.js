const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { normalizeVatId, defaultTaxTreatment } = require('../lib/vat');
const numbering = require('../lib/numbering');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const READERS = ['administrator', 'sales', 'accounting', 'planner'];
const EDITORS = ['administrator', 'sales', 'accounting'];

const optText = (max) => v.z.preprocess((x) => (x === '' ? null : x), v.z.string().trim().max(max).nullable().optional());

const customerSchema = v.z.object({
  customer_number: v.z.preprocess((x) => (x === '' ? undefined : x), v.z.string().trim().max(30).optional()),
  name: v.str(300),
  name2: optText(300),
  street: optText(300),
  postal_code: optText(20),
  city: optText(200),
  country: v.z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code, e.g. DE').default('DE'),
  vat_id: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().nullable().optional()
    .refine((x) => !x || normalizeVatId(x), 'Invalid EU VAT ID (example: ATU12345678)')
    .transform((x) => (x ? normalizeVatId(x) : x))),
  tax_treatment: v.z.enum(['domestic', 'intra_eu', 'export']).optional(),
  contact_person: optText(200),
  email: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().email().max(200).nullable().optional()),
  invoice_email: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().email().max(200).nullable().optional()),
  phone: optText(100),
  payment_terms_days: v.z.preprocess((x) => (x === '' ? null : x), v.z.coerce.number().int().min(0).max(365).nullable().optional()),
  skonto_days: v.z.preprocess((x) => (x === '' ? null : x), v.z.coerce.number().int().min(0).max(365).nullable().optional()),
  skonto_percent: v.z.preprocess((x) => (x === '' ? null : x), v.z.coerce.number().min(0).max(20).nullable().optional()),
  leitweg_id: optText(50),
  datev_account: v.z.preprocess((x) => (x === '' ? null : x), v.z.coerce.number().int().min(10000).max(69999).nullable().optional()),
  notes: optText(5000),
  active: v.flag.optional(),
  requires_certificates: v.flag.optional(),
});

const FIELDS = ['customer_number', 'name', 'name2', 'street', 'postal_code', 'city', 'country', 'vat_id', 'tax_treatment',
  'contact_person', 'email', 'invoice_email', 'phone', 'payment_terms_days', 'skonto_days', 'skonto_percent',
  'leitweg_id', 'datev_account', 'notes', 'active', 'requires_certificates'];

/** Intra-EU supply needs the customer's VAT ID; fall back to the default treatment otherwise. */
function resolveTaxTreatment(country, vatId, requested) {
  if (requested === 'intra_eu' && !vatId) return defaultTaxTreatment(country, vatId);
  return requested || defaultTaxTreatment(country, vatId);
}

// GET /api/customers?search=&active=1
router.get('/', requireRole(...READERS), h(async (req, res) => {
  const q = v.query(req, v.z.object({ search: v.z.string().max(100).optional(), active: v.flag.optional() }));
  const params = [];
  let sql = 'SELECT * FROM customers WHERE 1=1';
  if (q.active !== undefined) { sql += ' AND active = ?'; params.push(q.active); }
  if (q.search) {
    sql += ' AND (name ILIKE ? OR customer_number ILIKE ? OR city ILIKE ?)';
    const like = `%${q.search.replace(/[%_\\]/g, '\\$&')}%`;
    params.push(like, like, like);
  }
  res.json(await db.all(`${sql} ORDER BY name LIMIT 1000`, params));
}));

// GET /api/customers/:id — with document summary
router.get('/:id', requireRole(...READERS), h(async (req, res) => {
  const c = await db.get('SELECT * FROM customers WHERE id = ?', [v.paramId(req)]);
  if (!c) throw notFound('Customer');
  const open = await db.get(`
    SELECT COALESCE(SUM(gross_total - paid_total - credited_total), 0) AS open_amount, COUNT(*) AS open_invoices
    FROM sales_documents
    WHERE customer_id = ? AND doc_type = 'invoice' AND status IN ('issued','partially_paid')`, [c.id]);
  res.json({ ...c, ...open });
}));

// POST /api/customers
router.post('/', requireRole(...EDITORS), h(async (req, res) => {
  const b = v.body(req, customerSchema);
  const number = b.customer_number || await numbering.nextNumber('customer');
  const treatment = resolveTaxTreatment(b.country, b.vat_id, b.tax_treatment);
  const datev = b.datev_account ?? (/^\d{5}$/.test(number) && Number(number) >= 10000 && Number(number) <= 69999 ? Number(number) : null);
  const values = { ...b, customer_number: number, tax_treatment: treatment, datev_account: datev, active: b.active ?? 1, requires_certificates: b.requires_certificates ?? 0 };
  const row = await db.get(
    `INSERT INTO customers (${FIELDS.join(', ')}) VALUES (${FIELDS.map(() => '?').join(', ')}) RETURNING *`,
    FIELDS.map((f) => values[f] ?? null),
  );
  res.status(201).json(row);
}));

// PUT /api/customers/:id
router.put('/:id', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, customerSchema.partial());
  const c = await db.get('SELECT * FROM customers WHERE id = ? FOR UPDATE', [id]);
  if (!c) throw notFound('Customer');
  const merged = { ...c, ...Object.fromEntries(Object.entries(b).filter(([, val]) => val !== undefined)) };
  const treatmentInput = b.tax_treatment ?? ((b.country !== undefined || b.vat_id !== undefined) ? undefined : c.tax_treatment);
  merged.tax_treatment = resolveTaxTreatment(merged.country, merged.vat_id, treatmentInput);
  await db.run(
    `UPDATE customers SET ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
    [...FIELDS.map((f) => merged[f] ?? null), id],
  );
  res.json(await db.get('SELECT * FROM customers WHERE id = ?', [id]));
}));

// DELETE /api/customers/:id — deletes unused customers, deactivates customers with documents
router.delete('/:id', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const c = await db.get('SELECT id FROM customers WHERE id = ?', [id]);
  if (!c) throw notFound('Customer');
  const used = await db.get('SELECT id FROM sales_documents WHERE customer_id = ? LIMIT 1', [id]);
  if (used) {
    await db.run('UPDATE customers SET active = 0 WHERE id = ?', [id]);
    return res.json({ message: 'Customer has documents and was deactivated', deactivated: true });
  }
  await db.run('DELETE FROM customers WHERE id = ?', [id]);
  return res.json({ message: 'Customer deleted', deleted: true });
}));

module.exports = router;
module.exports.resolveTaxTreatment = resolveTaxTreatment;
