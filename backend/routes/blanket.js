/**
 * Blanket orders (Rahmenaufträge) with call-offs (Abrufe).
 * A call-off creates a draft order confirmation at the agreed prices; drafts
 * that are deleted release their quantity again.
 */
const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { nextNumber } = require('../lib/numbering');
const sales = require('../services/sales');

const router = express.Router();
router.use(authenticateToken);
const READERS = ['administrator', 'sales', 'accounting', 'planner'];
const EDITORS = ['administrator', 'sales'];
router.use(requireRole(...READERS));

const qty = v.z.coerce.number().positive().max(1e9);

/** Blanket order with lines and called-off / remaining quantities. */
async function load(id) {
  const b = await db.get(`SELECT bo.*, c.name AS customer_name FROM blanket_orders bo JOIN customers c ON c.id = bo.customer_id WHERE bo.id = ?`, [id]);
  if (!b) return null;
  const lines = await db.all(`
    SELECT bl.*, i.item_code, i.name AS item_name,
           COALESCE((SELECT SUM(bc.quantity) FROM blanket_calloffs bc WHERE bc.blanket_line_id = bl.id), 0) AS called_off
    FROM blanket_order_lines bl LEFT JOIN items i ON i.id = bl.item_id
    WHERE bl.blanket_id = ? ORDER BY bl.position`, [id]);
  const calloffs = await db.all(`
    SELECT bc.sales_document_id, sd.number, sd.status, sd.delivery_date, sd.created_at, SUM(bc.quantity) AS quantity
    FROM blanket_calloffs bc JOIN blanket_order_lines bl ON bl.id = bc.blanket_line_id JOIN sales_documents sd ON sd.id = bc.sales_document_id
    WHERE bl.blanket_id = ? GROUP BY bc.sales_document_id, sd.number, sd.status, sd.delivery_date, sd.created_at ORDER BY sd.created_at`, [id]);
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...b,
    expired: !!(b.valid_to && b.valid_to < today),
    lines: lines.map((l) => ({ ...l, called_off: Number(l.called_off), remaining: Math.round((Number(l.quantity) - Number(l.called_off)) * 1000) / 1000 })),
    calloffs,
  };
}

router.get('/', h(async (req, res) => {
  const q = v.query(req, v.z.object({ status: v.z.enum(['active', 'closed', 'all']).default('active'), customer_id: v.optId }));
  const rows = await db.all(`
    SELECT bo.id FROM blanket_orders bo
    WHERE (? = 'all' OR bo.status = ?) AND (?::int IS NULL OR bo.customer_id = ?) ORDER BY bo.id DESC LIMIT 300`,
  [q.status, q.status, q.customer_id ?? null, q.customer_id ?? null]);
  res.json(await Promise.all(rows.map((r) => load(r.id))));
}));

router.get('/:id', h(async (req, res) => {
  const b = await load(v.paramId(req));
  if (!b) throw notFound('Blanket order');
  res.json(b);
}));

const lineSchema = v.z.object({ item_id: v.optId, description: v.optStr(2000), quantity: qty, unit: v.optStr(20), unit_price: v.z.coerce.number().min(0) });
const schema = v.z.object({
  customer_id: v.id, customer_reference: v.optStr(200), valid_from: v.optDate, valid_to: v.optDate, notes: v.optStr(2000),
  lines: v.z.array(lineSchema).min(1).max(200),
});

async function writeLines(blanketId, lines) {
  for (const [i, l] of lines.entries()) {
    const item = l.item_id ? await db.get('SELECT name, uom FROM items WHERE id = ?', [l.item_id]) : null;
    if (l.item_id && !item) throw badRequest('Item not found');
    if (!l.item_id && !l.description) throw badRequest('Each line needs an item or a description');
    await db.run('INSERT INTO blanket_order_lines (blanket_id, position, item_id, description, quantity, unit, unit_price) VALUES (?,?,?,?,?,?,?)',
      [blanketId, i + 1, l.item_id ?? null, l.description || item?.name, l.quantity, l.unit || item?.uom || 'Stk', l.unit_price]);
  }
}

router.post('/', requireRole(...EDITORS), h(async (req, res) => {
  const b = v.body(req, schema);
  if (b.valid_from && b.valid_to && b.valid_to < b.valid_from) throw badRequest('Valid to is before valid from');
  if (!(await db.get('SELECT id FROM customers WHERE id = ?', [b.customer_id]))) throw badRequest('Customer not found');
  const row = await db.get(`INSERT INTO blanket_orders (number, customer_id, customer_reference, valid_from, valid_to, notes, created_by)
    VALUES (?,?,?,?,?,?,?) RETURNING id`, [await nextNumber('blanket_order'), b.customer_id, b.customer_reference ?? null, b.valid_from ?? null, b.valid_to ?? null, b.notes ?? null, req.user.id]);
  await writeLines(row.id, b.lines);
  res.status(201).json(await load(row.id));
}));

// PUT /api/blanket-orders/:id — header always; lines only while nothing was called off
router.put('/:id', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const cur = await load(id);
  if (!cur) throw notFound('Blanket order');
  const b = v.body(req, schema.partial().extend({ status: v.z.enum(['active', 'closed', 'cancelled']).optional() }));
  await db.run(`UPDATE blanket_orders SET customer_reference = ?, valid_from = ?, valid_to = ?, notes = ?, status = ? WHERE id = ?`,
    [b.customer_reference ?? cur.customer_reference, b.valid_from ?? cur.valid_from, b.valid_to ?? cur.valid_to, b.notes ?? cur.notes, b.status ?? cur.status, id]);
  if (b.lines) {
    if (cur.calloffs.length) throw badRequest('Lines cannot be changed after the first call-off');
    await db.run('DELETE FROM blanket_order_lines WHERE blanket_id = ?', [id]);
    await writeLines(id, b.lines);
  }
  res.json(await load(id));
}));

// POST /api/blanket-orders/:id/call-off { delivery_date?, customer_reference?, lines: [{ line_id, quantity }] }
router.post('/:id/call-off', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object({
    delivery_date: v.optDate, customer_reference: v.optStr(200),
    lines: v.z.array(v.z.object({ line_id: v.id, quantity: qty })).min(1).max(200),
  }));
  await db.get('SELECT id FROM blanket_orders WHERE id = ? FOR UPDATE', [id]);
  const bo = await load(id);
  if (!bo) throw notFound('Blanket order');
  if (bo.status !== 'active') throw badRequest('The blanket order is not active');
  const day = b.delivery_date || new Date().toISOString().slice(0, 10);
  if ((bo.valid_from && day < bo.valid_from) || (bo.valid_to && day > bo.valid_to)) throw badRequest('The delivery date is outside the validity of the blanket order');
  const docLines = [];
  for (const x of b.lines) {
    const l = bo.lines.find((y) => y.id === x.line_id);
    if (!l) throw badRequest('Line does not belong to this blanket order');
    if (x.quantity > l.remaining + 1e-9) throw badRequest(`${l.item_code || l.description}: only ${l.remaining} left on the blanket order`);
    docLines.push({ item_id: l.item_id ?? undefined, description: l.description, quantity: x.quantity, unit: l.unit, unit_price: Number(l.unit_price), blanket_line_id: l.id });
  }
  const doc = await sales.saveDraft(null, {
    doc_type: 'order', customer_id: bo.customer_id, delivery_date: b.delivery_date,
    customer_reference: [bo.customer_reference, b.customer_reference].filter(Boolean).join(' / ') || null,
    intro_text: `Abruf aus Rahmenauftrag ${bo.number}`,
    lines: docLines.map(({ blanket_line_id, ...l }) => l), // eslint-disable-line no-unused-vars
  }, req.user.id);
  for (const l of docLines) {
    await db.run('INSERT INTO blanket_calloffs (blanket_line_id, sales_document_id, quantity) VALUES (?, ?, ?)', [l.blanket_line_id, doc.id, l.quantity]);
  }
  // Fully called off: close automatically.
  const after = await load(id);
  if (after.lines.every((l) => l.remaining <= 0)) await db.run("UPDATE blanket_orders SET status = 'closed' WHERE id = ?", [id]);
  res.status(201).json({ document: doc, blanket: await load(id) });
}));

module.exports = router;
