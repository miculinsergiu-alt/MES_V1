const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest, AppError } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();
router.use(authenticateToken);

const EDITORS = ['administrator', 'planner', 'warehouse_manager', 'material_planner'];

// EU member states as used by VIES (Greece is 'EL'; 'XI' = Northern Ireland).
const VIES_COUNTRIES = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);
const VIES_TIMEOUT_MS = 8000;

/** Normalises a VAT id: 'de 123 456 789' -> { country: 'DE', number: '123456789' }. */
function parseVatId(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let country = clean.slice(0, 2);
  const number = clean.slice(2);
  if (country === 'GR') country = 'EL';
  if (!VIES_COUNTRIES.has(country) || !/^[A-Z0-9]{2,12}$/.test(number)) return null;
  return { country, number };
}

const optVat = v.z.preprocess(
  (x) => (x === '' || x === undefined ? null : x),
  v.z.string().max(30).nullable().refine((x) => x === null || parseVatId(x) !== null, 'Invalid EU VAT number (example: DE123456789)')
    .transform((x) => (x === null ? null : (({ country, number }) => country + number)(parseVatId(x)))),
).optional();

const supplierSchema = v.z.object({
  name: v.str(300),
  contact_person: v.optStr(200),
  email: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().email().max(200).nullable().optional()),
  phone: v.optStr(100),
  address: v.optStr(1000),
  vat_number: optVat,
  active: v.flag.optional(),
});

// GET /api/suppliers — all suppliers with their items
router.get('/', h(async (req, res) => {
  const suppliers = await db.all('SELECT * FROM suppliers ORDER BY name ASC');
  const items = await db.all(`
    SELECT its.*, i.item_code, i.name AS item_name
    FROM item_suppliers its JOIN items i ON its.item_id = i.id`);
  res.json(suppliers.map((s) => ({ ...s, items: items.filter((i) => i.supplier_id === s.id) })));
}));

// POST /api/suppliers
router.post('/', requireRole(...EDITORS), h(async (req, res) => {
  const b = v.body(req, supplierSchema);
  const row = await db.get(`
    INSERT INTO suppliers (name, contact_person, email, phone, address, vat_number, active)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  [b.name, b.contact_person ?? null, b.email ?? null, b.phone ?? null, b.address ?? null, b.vat_number ?? null, b.active ?? 1]);
  res.json({ id: row.id });
}));

// GET /api/suppliers/validate-vat/:vat — live check against the EU VIES service
const vatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  keyGenerator: (req) => `vat:${req.user?.company_id}`,
  message: { error: 'Too many VAT checks. Please wait a minute.', code: 'RATE_LIMITED' },
});

router.get('/validate-vat/:vat', vatLimiter, async (req, res) => {
  const vat = parseVatId(req.params.vat);
  if (!vat) throw badRequest('Invalid EU VAT number format (example: DE123456789)');

  let response;
  try {
    response = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${vat.country}/vat/${encodeURIComponent(vat.number)}`,
      { signal: AbortSignal.timeout(VIES_TIMEOUT_MS), headers: { Accept: 'application/json' } },
    );
  } catch {
    throw new AppError(503, 'VIES_UNAVAILABLE', 'The EU VAT service (VIES) could not be reached. Please try again later.');
  }
  if (!response.ok) {
    throw new AppError(503, 'VIES_UNAVAILABLE', 'The EU VAT service (VIES) returned an error. Please try again later.');
  }
  const data = await response.json();

  // VIES answers 200 with a userError when a national service is down.
  if (data.userError && !['VALID', 'INVALID'].includes(data.userError)) {
    throw new AppError(503, 'VIES_UNAVAILABLE', `The VAT service for ${vat.country} is currently unavailable (${data.userError}). Please try again later.`);
  }
  const clean = (s) => (typeof s === 'string' && s.trim() && s.trim() !== '---' ? s.trim() : null);
  res.json({
    vat_number: vat.country + vat.number,
    isValid: data.isValid === true,
    name: clean(data.name),
    address: clean(data.address),
    requestDate: data.requestDate ?? null,
  });
});

// PUT /api/suppliers/:id
router.put('/:id', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, supplierSchema.partial());
  const s = await db.get('SELECT * FROM suppliers WHERE id = ?', [id]);
  if (!s) throw notFound('Supplier');
  const pick = (k) => (b[k] !== undefined ? b[k] : s[k]);
  await db.run(`
    UPDATE suppliers SET name = ?, contact_person = ?, email = ?, phone = ?, address = ?, vat_number = ?, active = ?
    WHERE id = ?`,
  [pick('name'), pick('contact_person'), pick('email'), pick('phone'), pick('address'), pick('vat_number'), pick('active'), id]);
  res.json({ success: true });
}));

// GET /api/suppliers/item/:itemId — suppliers of an item
router.get('/item/:itemId', h(async (req, res) => {
  res.json(await db.all(`
    SELECT its.*, s.name AS supplier_name
    FROM item_suppliers its JOIN suppliers s ON its.supplier_id = s.id
    WHERE its.item_id = ?`, [v.paramId(req, 'itemId')]));
}));

// POST /api/suppliers/item — link (or update link of) an item and a supplier
router.post('/item', requireRole(...EDITORS), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    item_id: v.id,
    supplier_id: v.id,
    purchase_price: v.nonNeg.default(0),
    currency: v.z.string().trim().toUpperCase().length(3).default('EUR'),
    lead_time_days: v.nonNeg.default(0),
    last_negotiation_date: v.optDate,
    is_primary: v.flag.default(0),
  }));
  if (b.is_primary) {
    await db.run('UPDATE item_suppliers SET is_primary = 0 WHERE item_id = ? AND supplier_id <> ?', [b.item_id, b.supplier_id]);
  }
  const row = await db.get(`
    INSERT INTO item_suppliers (item_id, supplier_id, purchase_price, currency, lead_time_days, last_negotiation_date, is_primary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (item_id, supplier_id) DO UPDATE SET
      purchase_price = EXCLUDED.purchase_price, currency = EXCLUDED.currency, lead_time_days = EXCLUDED.lead_time_days,
      last_negotiation_date = EXCLUDED.last_negotiation_date, is_primary = EXCLUDED.is_primary
    RETURNING id`,
  [b.item_id, b.supplier_id, b.purchase_price, b.currency, b.lead_time_days, b.last_negotiation_date ?? null, b.is_primary]);
  res.json({ id: row.id });
}));

// DELETE /api/suppliers/item/:itemId/:supplierId
router.delete('/item/:itemId/:supplierId', requireRole(...EDITORS), h(async (req, res) => {
  await db.run('DELETE FROM item_suppliers WHERE item_id = ? AND supplier_id = ?',
    [v.paramId(req, 'itemId'), v.paramId(req, 'supplierId')]);
  res.json({ success: true });
}));

module.exports = router;
module.exports.parseVatId = parseVatId;
