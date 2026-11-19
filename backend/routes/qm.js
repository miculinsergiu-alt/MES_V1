/**
 * Quality management (mounted on /api/quality next to the quarantine routes):
 * inspection plans, measurements with automatic hold, inspection report PDF,
 * gauges with calibration dates, customer complaints with 8D.
 */
const express = require('express');
const PDFDocument = require('pdfkit');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, conflict, badRequest } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { judge, quarantineHeldLot } = require('../services/quality');
const { nextNumber } = require('../lib/numbering');

const router = express.Router();
router.use(authenticateToken);

const QUALITY_ROLES = ['administrator', 'warehouse_manager', 'material_planner', 'area_supervisor', 'planner'];
const PLANNERS = ['administrator', 'planner', 'area_supervisor', 'shift_responsible', 'warehouse_manager', 'material_planner'];
const optNum = v.z.preprocess((x) => (x === '' || x === null || x === undefined ? undefined : x), v.z.coerce.number().optional());

// ─── Inspection plan (Prüfplan) ─────────────────────────────────────────────
const characteristicSchema = v.z.object({
  id: v.optId,
  name: v.z.string().trim().min(1).max(200),
  kind: v.z.enum(['measure', 'attribute']).default('measure'),
  nominal: optNum,
  lower_limit: optNum,
  upper_limit: optNum,
  unit: v.z.string().trim().max(20).default('mm'),
  frequency: v.z.enum(['first', 'every_n', 'final', 'each']).default('first'),
  every_n: v.z.preprocess((x) => (x === '' || x === null ? undefined : x), v.z.coerce.number().int().positive().optional()),
  critical: v.flag.optional(),
  gauge_id: v.optId,
  incoming: v.flag.optional(),
}).superRefine((c, ctx) => {
  if (c.kind === 'measure' && (c.lower_limit === undefined || c.upper_limit === undefined)) ctx.addIssue({ code: 'custom', message: `${c.name}: lower and upper limit are required`, path: ['lower_limit'] });
  if (c.kind === 'measure' && c.lower_limit > c.upper_limit) ctx.addIssue({ code: 'custom', message: `${c.name}: lower limit is above upper limit`, path: ['upper_limit'] });
  if (c.frequency === 'every_n' && !c.every_n) ctx.addIssue({ code: 'custom', message: `${c.name}: enter every how many parts`, path: ['every_n'] });
});

const planOf = (itemId) => db.all(`
  SELECT ic.*, g.code AS gauge_code, g.name AS gauge_name, g.next_due AS gauge_next_due
  FROM inspection_characteristics ic LEFT JOIN gauges g ON g.id = ic.gauge_id
  WHERE ic.item_id = ? AND ic.active = 1 ORDER BY ic.position, ic.id`, [itemId]);

router.get('/plans/:itemId', h(async (req, res) => {
  const { itemId } = v.params(req, v.z.object({ itemId: v.z.coerce.number().int().positive() }));
  res.json(await planOf(itemId));
}));

// PUT /api/quality/plans/:itemId { characteristics } — replaces the plan; measured characteristics stay (inactive)
router.put('/plans/:itemId', requireRole(...PLANNERS), h(async (req, res) => {
  const { itemId } = v.params(req, v.z.object({ itemId: v.z.coerce.number().int().positive() }));
  const { characteristics } = v.body(req, v.z.object({ characteristics: v.z.array(characteristicSchema).max(200) }));
  if (!(await db.get('SELECT id FROM items WHERE id = ?', [itemId]))) throw notFound('Item');
  const keep = new Set();
  for (const [i, c] of characteristics.entries()) {
    const vals = [c.name, c.kind, c.nominal ?? null, c.kind === 'measure' ? c.lower_limit : null, c.kind === 'measure' ? c.upper_limit : null,
      c.unit, c.frequency, c.frequency === 'every_n' ? c.every_n : null, c.critical ?? 0, c.gauge_id ?? null, c.incoming ?? 0, i + 1];
    const existing = c.id ? await db.get('SELECT id FROM inspection_characteristics WHERE id = ? AND item_id = ?', [c.id, itemId]) : null;
    if (existing) {
      await db.run(`UPDATE inspection_characteristics SET name=?, kind=?, nominal=?, lower_limit=?, upper_limit=?, unit=?, frequency=?, every_n=?,
        critical=?, gauge_id=?, incoming=?, position=?, active=1 WHERE id=?`, [...vals, existing.id]);
      keep.add(existing.id);
    } else {
      const row = await db.get(`INSERT INTO inspection_characteristics (name, kind, nominal, lower_limit, upper_limit, unit, frequency, every_n, critical, gauge_id, incoming, position, item_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, [...vals, itemId]);
      keep.add(row.id);
    }
  }
  for (const old of await db.all('SELECT id FROM inspection_characteristics WHERE item_id = ?', [itemId])) {
    if (keep.has(old.id)) continue;
    const used = await db.get('SELECT id FROM measurements WHERE characteristic_id = ? LIMIT 1', [old.id]);
    if (used) await db.run('UPDATE inspection_characteristics SET active = 0 WHERE id = ?', [old.id]);
    else await db.run('DELETE FROM inspection_characteristics WHERE id = ?', [old.id]);
  }
  res.json(await planOf(itemId));
}));

// ─── Measurements on a production order ─────────────────────────────────────
async function rootOrder(orderId) {
  const o = await db.get('SELECT id, parent_order_id FROM orders WHERE id = ?', [orderId]);
  if (!o) throw notFound('Order');
  return db.get('SELECT o.*, i.item_code, i.name AS item_name FROM orders o LEFT JOIN items i ON i.id = o.item_id WHERE o.id = ?', [o.parent_order_id || o.id]);
}

async function inspectionStatus(root) {
  const plan = root.item_id ? await planOf(root.item_id) : [];
  const ms = await db.all(`
    SELECT m.*, u.first_name || ' ' || u.last_name AS measured_by_name, g.code AS gauge_code
    FROM measurements m LEFT JOIN users u ON u.id = m.measured_by LEFT JOIN gauges g ON g.id = m.gauge_id
    WHERE m.order_id = ? ORDER BY m.measured_at, m.id`, [root.id]);
  const produced = Number((await db.get(`
    SELECT COALESCE(SUM(pr.qty_ok + pr.qty_fail), 0) AS n FROM production_results pr
    JOIN orders o ON o.id = pr.order_id WHERE o.id = ? OR o.parent_order_id = ?`, [root.id, root.id])).n);
  const lastStep = await db.get('SELECT status FROM orders WHERE id = ? OR parent_order_id = ? ORDER BY routing_sequence DESC, id DESC LIMIT 1', [root.id, root.id]);
  const finished = lastStep?.status === 'done';
  const due = [];
  for (const c of plan) {
    const mine = ms.filter((m) => m.characteristic_id === c.id);
    const has = (stage) => mine.some((m) => m.stage === stage);
    if (['first', 'every_n', 'each'].includes(c.frequency) && !has('first')) due.push({ characteristic_id: c.id, stage: 'first' });
    if (c.frequency === 'every_n') {
      const needed = Math.floor(produced / c.every_n);
      const done = mine.filter((m) => m.stage === 'in_process').length;
      if (done < needed) due.push({ characteristic_id: c.id, stage: 'in_process', count: needed - done });
    }
    if (['final', 'every_n', 'each'].includes(c.frequency) && finished && !has('final')) due.push({ characteristic_id: c.id, stage: 'final' });
  }
  return {
    order: { id: root.id, product_name: root.product_name, item_id: root.item_id, item_code: root.item_code, item_name: root.item_name,
      quantity: root.quantity, status: root.status, quality_hold: root.quality_hold, quality_released_at: root.quality_released_at },
    plan, measurements: ms, due, produced, nok_count: ms.filter((m) => m.result === 'nok').length,
  };
}

router.get('/orders/:orderId/inspection', h(async (req, res) => {
  const { orderId } = v.params(req, v.z.object({ orderId: v.z.coerce.number().int().positive() }));
  res.json(await inspectionStatus(await rootOrder(orderId)));
}));

// POST /api/quality/orders/:orderId/measurements — operators and quality record values
router.post('/orders/:orderId/measurements', h(async (req, res) => {
  const { orderId } = v.params(req, v.z.object({ orderId: v.z.coerce.number().int().positive() }));
  const b = v.body(req, v.z.object({
    stage: v.z.enum(['first', 'in_process', 'final']),
    gauge_id: v.optId,
    notes: v.optStr(1000),
    values: v.z.array(v.z.object({ characteristic_id: v.id, value: optNum, ok: v.z.boolean().optional(), gauge_id: v.optId })).min(1).max(200),
  }));
  const root = await rootOrder(orderId);
  const today = new Date().toISOString().slice(0, 10);
  const results = [];
  for (const x of b.values) {
    const ch = await db.get('SELECT * FROM inspection_characteristics WHERE id = ? AND item_id = ? AND active = 1', [x.characteristic_id, root.item_id]);
    if (!ch) throw badRequest('Characteristic does not belong to this item');
    if (ch.kind === 'measure' && x.value === undefined) throw badRequest(`${ch.name}: value missing`);
    if (ch.kind === 'attribute' && x.ok === undefined) throw badRequest(`${ch.name}: OK / not OK missing`);
    const gaugeId = x.gauge_id ?? b.gauge_id ?? ch.gauge_id ?? null;
    if (gaugeId) {
      const g = await db.get('SELECT code, next_due, active FROM gauges WHERE id = ?', [gaugeId]);
      if (!g || !g.active) throw badRequest('Gauge not found or inactive');
      if (g.next_due && g.next_due < today) throw badRequest(`Gauge ${g.code} is overdue for calibration (${g.next_due})`);
    }
    const result = judge(ch, x.value, x.ok);
    const sample = (await db.get('SELECT COALESCE(MAX(sample_no), 0) AS n FROM measurements WHERE order_id = ? AND characteristic_id = ? AND stage = ?', [root.id, ch.id, b.stage])).n + 1;
    await db.run(`
      INSERT INTO measurements (characteristic_id, order_id, stage, sample_no, value, attribute_ok, result, gauge_id, measured_by, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [ch.id, root.id, b.stage, sample, ch.kind === 'measure' ? x.value : null, ch.kind === 'attribute' ? (x.ok ? 1 : 0) : null, result, gaugeId, req.user.id, b.notes ?? null]);
    results.push({ characteristic_id: ch.id, name: ch.name, result });
  }
  const hold = results.some((r) => r.result === 'nok');
  if (hold) {
    await db.run('UPDATE orders SET quality_hold = 1, quality_released_by = NULL, quality_released_at = NULL WHERE id = ?', [root.id]);
    await quarantineHeldLot(root.id, req.user.id);
  }
  res.status(201).json({ results, hold });
}));

// POST /api/quality/orders/:orderId/release — quality decides the order may continue
router.post('/orders/:orderId/release', requireRole(...QUALITY_ROLES), h(async (req, res) => {
  const { orderId } = v.params(req, v.z.object({ orderId: v.z.coerce.number().int().positive() }));
  const root = await rootOrder(orderId);
  if (!root.quality_hold) throw badRequest('The order is not on hold');
  await db.run('UPDATE orders SET quality_hold = 0, quality_released_by = ?, quality_released_at = nova_now() WHERE id = ?', [req.user.id, root.id]);
  res.json(await inspectionStatus(await rootOrder(root.id)));
}));

// GET /api/quality/orders/:orderId/report.pdf?stage=first|in_process|final|all
router.get('/orders/:orderId/report.pdf', h(async (req, res) => {
  const { orderId } = v.params(req, v.z.object({ orderId: v.z.coerce.number().int().positive() }));
  const q = v.query(req, v.z.object({ stage: v.z.enum(['first', 'in_process', 'final', 'all']).default('all') }));
  const st = await inspectionStatus(await rootOrder(orderId));
  const company = await db.get('SELECT name, legal_name FROM companies WHERE id = ?', [req.user.company_id]);
  const ms = st.measurements.filter((m) => q.stage === 'all' || m.stage === q.stage);
  const STAGE = { first: 'Erstteil', in_process: 'Zwischen', final: 'Endprüf.' };
  const fmt = (x) => (x === null || x === undefined ? '' : Number(x).toLocaleString('de-DE', { maximumFractionDigits: 4 }));

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', r));
  doc.fontSize(9).fillColor('#555').text(company?.legal_name || company?.name || '');
  doc.moveDown(0.5).fillColor('#000').fontSize(16).text(q.stage === 'first' ? 'Erstmusterprüfbericht / First article inspection' : 'Messprotokoll / Inspection report');
  doc.fontSize(10).text(`Artikel: ${st.order.item_code || ''} ${st.order.item_name || st.order.product_name}   ·   Auftrag #${st.order.id}   ·   Menge ${st.order.quantity}`);
  doc.text(`Datum: ${new Date().toISOString().slice(0, 10)}   ·   Gesamtergebnis: ${ms.some((m) => m.result === 'nok') ? 'NICHT i.O.' : 'i.O.'}`);
  doc.moveDown();
  const cols = [40, 190, 255, 335, 395, 455, 510];
  const row = (cells, bold) => {
    if (doc.y > 770) doc.addPage();
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    cells.forEach((c, i) => doc.text(String(c ?? ''), cols[i], y, { width: (cols[i + 1] || 555) - cols[i] - 4, lineBreak: false, ellipsis: true }));
    doc.y = y + 13; doc.x = 40;
  };
  row(['Merkmal', 'Soll', 'Toleranz', 'Ist', 'Prüfung', 'Prüfmittel', 'Erg.'], true);
  for (const m of ms) {
    const c = st.plan.find((p) => p.id === m.characteristic_id) || {};
    row([
      `${c.position ?? ''} ${c.name || ''}${c.critical ? ' *' : ''}`,
      c.kind === 'attribute' ? 'i.O.' : `${fmt(c.nominal)} ${c.unit || ''}`,
      c.kind === 'attribute' ? '' : `${fmt(c.lower_limit)} - ${fmt(c.upper_limit)}`,
      c.kind === 'attribute' ? (m.attribute_ok ? 'i.O.' : 'n.i.O.') : fmt(m.value),
      `${STAGE[m.stage] || m.stage} ${m.sample_no}`,
      m.gauge_code || '',
      m.result === 'ok' ? 'i.O.' : 'n.i.O.',
    ]);
  }
  if (!ms.length) doc.text('Keine Messwerte.');
  doc.moveDown(2).fontSize(8).fillColor('#555').text(`* kritisches Merkmal. Geprüft von: ${[...new Set(ms.map((m) => m.measured_by_name).filter(Boolean))].join(', ')}`);
  doc.end();
  await done;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Messprotokoll_${st.order.id}.pdf"`);
  res.send(Buffer.concat(chunks));
}));

// ─── Gauges (Prüfmittel) ────────────────────────────────────────────────────
const gaugeSchema = v.z.object({
  code: v.z.string().trim().min(1).max(50), name: v.z.string().trim().min(1).max(200),
  gauge_type: v.optStr(100), location: v.optStr(100),
  interval_months: v.z.coerce.number().int().min(1).max(120).default(12),
  last_calibrated: v.optDate, notes: v.optStr(2000), active: v.flag.optional(),
});
const addMonths = (d, n) => {
  if (!d) return null;
  const x = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + Number(n));
  return x.toISOString().slice(0, 10);
};

router.get('/gauges', h(async (req, res) => {
  const rows = await db.all('SELECT * FROM gauges ORDER BY active DESC, next_due NULLS LAST, code');
  const today = new Date().toISOString().slice(0, 10);
  res.json(rows.map((g) => ({ ...g, overdue: !!(g.next_due && g.next_due < today) })));
}));
router.post('/gauges', requireRole(...QUALITY_ROLES), h(async (req, res) => {
  const b = v.body(req, gaugeSchema);
  if (await db.get('SELECT id FROM gauges WHERE code = ?', [b.code])) throw conflict('A gauge with this code exists');
  res.status(201).json(await db.get(`INSERT INTO gauges (code, name, gauge_type, location, interval_months, last_calibrated, next_due, notes)
    VALUES (?,?,?,?,?,?,?,?) RETURNING *`, [b.code, b.name, b.gauge_type ?? null, b.location ?? null, b.interval_months, b.last_calibrated ?? null, addMonths(b.last_calibrated, b.interval_months), b.notes ?? null]));
}));
router.put('/gauges/:id', requireRole(...QUALITY_ROLES), h(async (req, res) => {
  const id = v.paramId(req);
  const g = await db.get('SELECT * FROM gauges WHERE id = ?', [id]);
  if (!g) throw notFound('Gauge');
  const b = { ...g, ...Object.fromEntries(Object.entries(v.body(req, gaugeSchema.partial())).filter(([, x]) => x !== undefined)) };
  res.json(await db.get('UPDATE gauges SET code=?, name=?, gauge_type=?, location=?, interval_months=?, last_calibrated=?, next_due=?, notes=?, active=? WHERE id=? RETURNING *',
    [b.code, b.name, b.gauge_type, b.location, b.interval_months, b.last_calibrated, addMonths(b.last_calibrated, b.interval_months), b.notes, b.active ?? 1, id]));
}));
router.post('/gauges/:id/calibrated', requireRole(...QUALITY_ROLES), h(async (req, res) => {
  const id = v.paramId(req);
  const { date } = v.body(req, v.z.object({ date: v.optDate }));
  const g = await db.get('SELECT * FROM gauges WHERE id = ?', [id]);
  if (!g) throw notFound('Gauge');
  const d = date || new Date().toISOString().slice(0, 10);
  res.json(await db.get('UPDATE gauges SET last_calibrated = ?, next_due = ? WHERE id = ? RETURNING *', [d, addMonths(d, g.interval_months), id]));
}));

// ─── Complaints (Reklamationen) with 8D ─────────────────────────────────────
const D8 = ['d1_team', 'd2_problem', 'd3_containment', 'd4_root_cause', 'd5_corrective', 'd6_implemented', 'd7_prevention', 'd8_closure'];
const complaintSchema = v.z.object({
  customer_id: v.optId, item_id: v.optId, lot_number: v.optStr(100), delivery_document_id: v.optId,
  customer_reference: v.optStr(100), quantity: optNum, description: v.z.string().trim().min(1).max(5000),
  status: v.z.enum(['open', 'analysis', 'action', 'closed', 'rejected']).optional(), cost: optNum, due_date: v.optDate,
  ...Object.fromEntries(D8.map((k) => [k, v.optStr(5000)])),
});
const COMPLAINT_SELECT = `SELECT cp.*, c.name AS customer_name, i.item_code, i.name AS item_name, sd.number AS delivery_number
  FROM complaints cp LEFT JOIN customers c ON c.id = cp.customer_id LEFT JOIN items i ON i.id = cp.item_id
  LEFT JOIN sales_documents sd ON sd.id = cp.delivery_document_id`;
const COMPLAINT_ROLES = [...QUALITY_ROLES, 'sales'];
const FIELDS = ['customer_id', 'item_id', 'lot_number', 'delivery_document_id', 'customer_reference', 'quantity', 'description', 'cost', 'due_date', ...D8];

router.get('/complaints', h(async (req, res) => {
  const q = v.query(req, v.z.object({ status: v.z.enum(['open', 'closed', 'all']).default('open') }));
  const where = q.status === 'open' ? "WHERE cp.status IN ('open','analysis','action')" : q.status === 'closed' ? "WHERE cp.status IN ('closed','rejected')" : '';
  res.json(await db.all(`${COMPLAINT_SELECT} ${where} ORDER BY cp.id DESC LIMIT 300`));
}));
router.get('/complaints/:id', h(async (req, res) => {
  const row = await db.get(`${COMPLAINT_SELECT} WHERE cp.id = ?`, [v.paramId(req)]);
  if (!row) throw notFound('Complaint');
  res.json(row);
}));
router.post('/complaints', requireRole(...COMPLAINT_ROLES), h(async (req, res) => {
  const b = v.body(req, complaintSchema);
  const row = await db.get(`INSERT INTO complaints (number, created_by, ${FIELDS.join(', ')}) VALUES (?, ?, ${FIELDS.map(() => '?').join(', ')}) RETURNING id`,
    [await nextNumber('complaint'), req.user.id, ...FIELDS.map((f) => b[f] ?? null)]);
  // Containment (D3): the complained lot goes into quarantine right away.
  if (b.lot_number) {
    const lot = await db.get('SELECT id, item_id, lot_number, quantity FROM inventory_lots WHERE lot_number = ?', [b.lot_number]);
    const open = lot ? await db.get("SELECT id FROM quarantine_logs WHERE lot_number = ? AND status = 'pending'", [lot.lot_number]) : null;
    if (lot && !open && Number(lot.quantity) > 0) {
      await db.run('INSERT INTO quarantine_logs (item_id, lot_number, quantity, reason, reported_by) VALUES (?,?,?,?,?)',
        [lot.item_id, lot.lot_number, lot.quantity, 'Kundenreklamation / customer complaint', req.user.id]);
    }
  }
  res.status(201).json(await db.get(`${COMPLAINT_SELECT} WHERE cp.id = ?`, [row.id]));
}));
router.put('/complaints/:id', requireRole(...COMPLAINT_ROLES), h(async (req, res) => {
  const id = v.paramId(req);
  const cur = await db.get('SELECT * FROM complaints WHERE id = ?', [id]);
  if (!cur) throw notFound('Complaint');
  const b = v.body(req, complaintSchema.partial());
  const merged = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, x]) => x !== undefined)) };
  if (merged.status === 'closed' && !merged.d8_closure) throw badRequest('Fill in D8 (closure) before closing');
  const closed = ['closed', 'rejected'].includes(merged.status);
  await db.run(`UPDATE complaints SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, status = ?, closed_at = ${closed ? 'COALESCE(closed_at, nova_now())' : 'NULL'} WHERE id = ?`,
    [...FIELDS.map((f) => merged[f] ?? null), merged.status, id]);
  res.json(await db.get(`${COMPLAINT_SELECT} WHERE cp.id = ?`, [id]));
}));
router.get('/complaints/:id/8d.pdf', h(async (req, res) => {
  const cp = await db.get(`${COMPLAINT_SELECT} WHERE cp.id = ?`, [v.paramId(req)]);
  if (!cp) throw notFound('Complaint');
  const company = await db.get('SELECT name, legal_name FROM companies WHERE id = ?', [req.user.company_id]);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', r));
  doc.fontSize(9).fillColor('#555').text(company?.legal_name || company?.name || '');
  doc.moveDown(0.5).fillColor('#000').fontSize(16).text(`8D-Report ${cp.number}`);
  doc.fontSize(10).text(`Kunde: ${cp.customer_name || '-'}   ·   Ref.: ${cp.customer_reference || '-'}   ·   Status: ${cp.status}`);
  doc.text(`Artikel: ${[cp.item_code, cp.item_name].filter(Boolean).join(' ') || '-'}   ·   Charge: ${cp.lot_number || '-'}   ·   Lieferschein: ${cp.delivery_number || '-'}   ·   Menge: ${cp.quantity ?? '-'}`);
  doc.moveDown().font('Helvetica-Bold').text('Beschreibung').font('Helvetica').text(cp.description);
  const titles = ['D1 Team', 'D2 Problembeschreibung', 'D3 Sofortmaßnahmen', 'D4 Ursachenanalyse', 'D5 Abstellmaßnahmen', 'D6 Umsetzung & Wirksamkeit', 'D7 Vorbeugung', 'D8 Abschluss'];
  D8.forEach((k, i) => { doc.moveDown(0.8).font('Helvetica-Bold').text(titles[i]).font('Helvetica').text(cp[k] || '-'); });
  doc.end();
  await done;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="8D_${cp.number}.pdf"`);
  res.send(Buffer.concat(chunks));
}));

module.exports = router;
