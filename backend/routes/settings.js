const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { badRequest, notFound } = require('../lib/errors');
const { normalizeVatId } = require('../lib/vat');
const numbering = require('../lib/numbering');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const COMPANY_FIELDS = [
  'name', 'legal_name', 'street', 'postal_code', 'city', 'country', 'vat_id', 'tax_number',
  'register_court', 'register_number', 'managing_directors', 'email', 'phone', 'website',
  'bank_name', 'iban', 'bic', 'logo_data_url', 'default_payment_terms_days', 'default_skonto_days',
  'default_skonto_percent', 'small_business', 'invoice_footer_text', 'datev_consultant_number',
  'datev_client_number', 'datev_chart', 'dunning_fee', 'dunning_grace_days', 'timezone',
  'negative_stock', 'labor_rate', 'calc_material_surcharge', 'calc_overhead', 'calc_margin',
];

/** IBAN check digits (ISO 13616, mod 97). */
function isValidIban(iban) {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

const optText = (max) => v.z.preprocess((x) => (x === '' ? null : x), v.z.string().trim().max(max).nullable().optional());
const optInt = (min, max) => v.z.preprocess((x) => (x === '' || x === null ? null : x), v.z.coerce.number().int().min(min).max(max).nullable().optional());

const settingsSchema = v.z.object({
  name: v.str(200).optional(),
  legal_name: optText(300),
  street: optText(300),
  postal_code: optText(20),
  city: optText(200),
  country: v.z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  vat_id: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().nullable().optional()
    .refine((x) => !x || normalizeVatId(x), 'Invalid EU VAT ID').transform((x) => (x ? normalizeVatId(x) : x))),
  tax_number: optText(50),
  register_court: optText(200),
  register_number: optText(100),
  managing_directors: optText(500),
  email: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().email().max(200).nullable().optional()),
  phone: optText(100),
  website: optText(200),
  bank_name: optText(200),
  iban: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().nullable().optional()
    .refine((x) => !x || isValidIban(x), 'Invalid IBAN').transform((x) => (x ? x.replace(/\s+/g, '').toUpperCase() : x))),
  bic: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, 'Invalid BIC').nullable().optional()),
  logo_data_url: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().max(400000)
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Logo must be a PNG or JPEG image').nullable().optional()),
  default_payment_terms_days: v.z.coerce.number().int().min(0).max(365).optional(),
  default_skonto_days: optInt(0, 365),
  default_skonto_percent: v.z.preprocess((x) => (x === '' ? null : x), v.z.coerce.number().min(0).max(20).nullable().optional()),
  small_business: v.flag.optional(),
  invoice_footer_text: optText(2000),
  datev_consultant_number: optInt(1000, 9999999),
  datev_client_number: optInt(1, 99999),
  datev_chart: v.z.enum(['SKR03', 'SKR04']).optional(),
  dunning_fee: v.z.coerce.number().min(0).max(1000).optional(),
  dunning_grace_days: v.z.coerce.number().int().min(0).max(90).optional(),
  negative_stock: v.z.enum(['allow', 'warn', 'block']).optional(),
  labor_rate: v.z.coerce.number().min(0).max(10000).optional(),
  calc_material_surcharge: v.z.coerce.number().min(0).max(500).optional(),
  calc_overhead: v.z.coerce.number().min(0).max(500).optional(),
  calc_margin: v.z.coerce.number().min(0).max(500).optional(),
  timezone: v.z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown time zone').optional(),
});

/** Company data needed on invoices; returns the list of missing fields. */
function missingInvoiceData(c) {
  const missing = [];
  if (!c.legal_name && !c.name) missing.push('legal_name');
  if (!c.street) missing.push('street');
  if (!c.postal_code) missing.push('postal_code');
  if (!c.city) missing.push('city');
  if (!c.vat_id && !c.tax_number) missing.push('vat_id or tax_number');
  return missing;
}

// GET /api/settings/company
router.get('/company', h(async (req, res) => {
  const c = await db.get('SELECT * FROM companies WHERE id = ?', [req.user.company_id]);
  if (!c) throw notFound('Company');
  res.json({ ...c, missing_for_invoices: missingInvoiceData(c) });
}));

// PUT /api/settings/company (administrator)
router.put('/company', requireRole('administrator'), h(async (req, res) => {
  const b = v.body(req, settingsSchema);
  const fields = COMPANY_FIELDS.filter((f) => b[f] !== undefined);
  if (!fields.length) throw badRequest('Nothing to update');
  await db.run(
    `UPDATE companies SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
    [...fields.map((f) => b[f]), req.user.company_id],
  );
  const c = await db.get('SELECT * FROM companies WHERE id = ?', [req.user.company_id]);
  res.json({ ...c, missing_for_invoices: missingInvoiceData(c) });
}));

// GET /api/settings/number-series — all series with a preview of the next number
router.get('/number-series', requireRole('administrator', 'accounting'), h(async (req, res) => {
  const out = [];
  for (const docType of Object.keys(numbering.DEFAULTS)) {
    await numbering.ensureSeries(docType);
    const s = await db.get('SELECT * FROM number_series WHERE doc_type = ?', [docType]);
    out.push({ ...s, next_preview: await numbering.peekNumber(docType) });
  }
  res.json(out);
}));

// PUT /api/settings/number-series/:docType — change prefix / digits / next number (never backwards)
router.put('/number-series/:docType', requireRole('administrator'), h(async (req, res) => {
  const { docType } = v.params(req, v.z.object({ docType: v.z.enum(Object.keys(numbering.DEFAULTS)) }));
  const b = v.body(req, v.z.object({
    prefix: v.z.string().trim().max(10).regex(/^[A-Z0-9]*$/i, 'Letters and digits only').optional(),
    digits: v.z.coerce.number().int().min(3).max(10).optional(),
    next_number: v.z.coerce.number().int().min(1).optional(),
  }));
  await numbering.ensureSeries(docType);
  const s = await db.get('SELECT * FROM number_series WHERE doc_type = ? FOR UPDATE', [docType]);
  if (b.next_number !== undefined && b.next_number < s.next_number) {
    throw badRequest('The next number cannot be lower than the current one (numbers must not repeat)');
  }
  if (b.prefix !== undefined && b.prefix !== s.prefix) {
    const used = await db.get('SELECT id FROM sales_documents WHERE doc_type = ? AND number IS NOT NULL LIMIT 1', [docType]);
    if (used && docType !== 'customer') throw badRequest('The prefix cannot be changed after documents have been issued');
  }
  await db.run('UPDATE number_series SET prefix = ?, digits = ?, next_number = ? WHERE id = ?',
    [b.prefix !== undefined ? b.prefix.toUpperCase() : s.prefix, b.digits ?? s.digits, b.next_number ?? s.next_number, s.id]);
  res.json({ message: 'Number series updated' });
}));

module.exports = router;
module.exports.missingInvoiceData = missingInvoiceData;
module.exports.isValidIban = isValidIban;
