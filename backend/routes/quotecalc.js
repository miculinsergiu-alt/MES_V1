/**
 * Vorkalkulation API + quote outcomes (won/lost with reason) + win-rate stats.
 */
const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const calc = require('../services/quotecalc');

const router = express.Router();
router.use(authenticateToken);
router.use(requireRole('administrator', 'sales', 'planner', 'accounting'));

const num = v.z.coerce.number().min(0);
const overridesSchema = v.z.object({
  rates: v.z.object({ labor_rate: num, material_surcharge: num.max(500), overhead: num.max(500), margin: num.max(500) }).partial().optional(),
  materials: v.z.array(v.z.object({ item_id: v.optId, item_code: v.optStr(100), name: v.optStr(300), qty_per_piece: num, unit_cost: num })).max(200).optional(),
  steps: v.z.array(v.z.object({
    sequence: v.z.coerce.number().int().optional(), step_type: v.z.enum(['internal', 'external']),
    machine_name: v.optStr(200), hourly_rate: num.optional(), setup_min: num.optional(), minutes_per_piece: num.optional(),
    supplier_name: v.optStr(200), price_per_piece: num.optional(), min_charge: num.optional(),
  })).max(100).optional(),
}).optional();

const calcSchema = v.z.object({
  item_id: v.id,
  quantities: v.z.array(v.z.coerce.number().positive().max(1e7)).min(1).max(10),
  extra_per_batch: num.optional(),
  overrides: overridesSchema,
});

async function buildInput(b) {
  const base = await calc.inputsFor(b.item_id);
  if (!base) throw notFound('Item');
  const o = b.overrides || {};
  return {
    item: base.item,
    rates: { ...base.rates, ...(o.rates || {}) },
    materials: o.materials || base.materials,
    steps: (o.steps || base.steps).map((s) => ({
      ...s, hourly_rate: s.hourly_rate ?? 0, setup_min: s.setup_min ?? 0, minutes_per_piece: s.minutes_per_piece ?? 0,
      price_per_piece: s.price_per_piece ?? 0, min_charge: s.min_charge ?? 0,
    })),
  };
}

// GET /api/quote-calc/inputs/:itemId — master data the calculation starts from
router.get('/inputs/:itemId', h(async (req, res) => {
  const { itemId } = v.params(req, v.z.object({ itemId: v.z.coerce.number().int().positive() }));
  const input = await calc.inputsFor(itemId);
  if (!input) throw notFound('Item');
  const warnings = [];
  if (!input.steps.length) warnings.push('NO_ROUTING');
  if (!input.materials.length) warnings.push('NO_BOM');
  if (input.steps.some((s) => s.step_type === 'internal' && !s.hourly_rate)) warnings.push('MACHINE_RATE_MISSING');
  if (!input.rates.labor_rate) warnings.push('LABOR_RATE_MISSING');
  res.json({ ...input, warnings });
}));

// POST /api/quote-calc/preview — calculate without saving
router.post('/preview', h(async (req, res) => {
  const b = v.body(req, calcSchema);
  const input = await buildInput(b);
  res.json({ item: input.item, tiers: calc.calculate(input, b.quantities, b.extra_per_batch) });
}));

// POST /api/quote-calc — calculate and save a snapshot (to attach to a quote line)
router.post('/', h(async (req, res) => {
  const b = v.body(req, calcSchema.extend({ customer_id: v.optId, notes: v.optStr(2000) }));
  const input = await buildInput(b);
  const tiers = calc.calculate(input, b.quantities, b.extra_per_batch);
  const row = await db.get(
    'INSERT INTO quote_calculations (item_id, customer_id, input, result, notes, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, created_at',
    [b.item_id, b.customer_id ?? null, JSON.stringify({ ...input, quantities: b.quantities, extra_per_batch: b.extra_per_batch ?? 0 }), JSON.stringify({ tiers }), b.notes ?? null, req.user.id],
  );
  res.status(201).json({ id: row.id, created_at: row.created_at, item: input.item, tiers });
}));

// GET /api/quote-calc?item_id= — saved calculations
router.get('/', h(async (req, res) => {
  const q = v.query(req, v.z.object({ item_id: v.optId }));
  res.json(await db.all(`
    SELECT qc.id, qc.item_id, i.item_code, i.name AS item_name, qc.customer_id, c.name AS customer_name, qc.result, qc.notes, qc.created_at
    FROM quote_calculations qc JOIN items i ON i.id = qc.item_id LEFT JOIN customers c ON c.id = qc.customer_id
    WHERE (?::int IS NULL OR qc.item_id = ?) ORDER BY qc.id DESC LIMIT 100`, [q.item_id ?? null, q.item_id ?? null]));
}));

// ─── Quote outcomes (win / loss) ────────────────────────────────────────────

// POST /api/quote-calc/outcome/:documentId { outcome, reason?, competitor?, competitor_price?, notes? }
router.post('/outcome/:documentId', h(async (req, res) => {
  const { documentId } = v.params(req, v.z.object({ documentId: v.z.coerce.number().int().positive() }));
  const b = v.body(req, v.z.object({
    outcome: v.z.enum(['won', 'lost']),
    reason: v.z.enum(['price', 'delivery_time', 'quality', 'no_demand', 'competitor', 'other']).optional(),
    competitor: v.optStr(200), competitor_price: num.optional(), notes: v.optStr(2000),
  }));
  const doc = await db.get('SELECT id, doc_type, locked, status FROM sales_documents WHERE id = ?', [documentId]);
  if (!doc) throw notFound('Document');
  if (doc.doc_type !== 'quote' || !doc.locked) throw badRequest('Only issued quotes have an outcome');
  if (b.outcome === 'lost' && !b.reason) throw badRequest('Please choose a reason');
  await db.run(`
    INSERT INTO quote_outcomes (document_id, outcome, reason, competitor, competitor_price, notes) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (document_id) DO UPDATE SET outcome = EXCLUDED.outcome, reason = EXCLUDED.reason, competitor = EXCLUDED.competitor,
      competitor_price = EXCLUDED.competitor_price, notes = EXCLUDED.notes`,
  [documentId, b.outcome, b.outcome === 'lost' ? b.reason : null, b.competitor ?? null, b.competitor_price ?? null, b.notes ?? null]);
  // Keep the document status in line (allowed on issued quotes).
  const status = b.outcome === 'won' ? 'accepted' : 'declined';
  if (doc.status !== status && doc.status !== 'converted') await db.run('UPDATE sales_documents SET status = ? WHERE id = ?', [status, documentId]);
  res.json(await db.get('SELECT * FROM quote_outcomes WHERE document_id = ?', [documentId]));
}));

router.get('/outcome/:documentId', h(async (req, res) => {
  const { documentId } = v.params(req, v.z.object({ documentId: v.z.coerce.number().int().positive() }));
  res.json(await db.get('SELECT * FROM quote_outcomes WHERE document_id = ?', [documentId]) || null);
}));

// GET /api/quote-calc/stats?from=&to= — win rate and loss reasons
router.get('/stats', h(async (req, res) => {
  const q = v.query(req, v.z.object({ from: v.optDate, to: v.optDate }));
  const quotes = await db.all(`
    SELECT sd.id, sd.status, sd.net_total, qo.outcome, qo.reason
    FROM sales_documents sd LEFT JOIN quote_outcomes qo ON qo.document_id = sd.id
    WHERE sd.doc_type = 'quote' AND sd.locked = 1
      AND (?::date IS NULL OR sd.document_date::date >= ?::date) AND (?::date IS NULL OR sd.document_date::date <= ?::date)`,
  [q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null]);
  const won = quotes.filter((x) => x.outcome === 'won' || (!x.outcome && ['accepted', 'converted'].includes(x.status)));
  const lost = quotes.filter((x) => x.outcome === 'lost' || (!x.outcome && x.status === 'declined'));
  const decided = won.length + lost.length;
  const reasons = {};
  for (const l of lost) reasons[l.reason || 'unknown'] = (reasons[l.reason || 'unknown'] || 0) + 1;
  const sum = (rows) => Math.round(rows.reduce((s, r) => s + (Number(r.net_total) || 0), 0) * 100) / 100;
  res.json({
    quotes: quotes.length, open: quotes.length - decided, won: won.length, lost: lost.length,
    win_rate: decided ? Math.round((won.length / decided) * 1000) / 10 : null,
    won_value: sum(won), lost_value: sum(lost), loss_reasons: reasons,
  });
}));

// GET /api/quote-calc/:id — one saved calculation (last, so /stats and /outcome match first)
router.get('/:id', h(async (req, res) => {
  const row = await db.get('SELECT * FROM quote_calculations WHERE id = ?', [v.paramId(req)]);
  if (!row) throw notFound('Calculation');
  res.json(row);
}));

module.exports = router;
