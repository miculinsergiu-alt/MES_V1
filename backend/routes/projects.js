/**
 * Projects: one customer job across documents, production, purchasing and
 * outside processing, with budget vs. actual.
 *
 * Revenue: invoices (net) minus credit notes; order intake: order confirmations.
 * Cost: actual cost of the production orders (Nachkalkulation: material,
 * machine, labour, outside processing), plus purchase orders bought directly
 * for the project (buy-outs) and outside processing jobs linked on their own.
 * Production orders made for a linked order confirmation count automatically.
 */
const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest, conflict } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { nextNumber } = require('../lib/numbering');
const { costOrder } = require('../services/costing');

const router = express.Router();
router.use(authenticateToken);
router.use(requireRole('administrator', 'planner', 'sales', 'accounting', 'area_supervisor'));
const EDITORS = ['administrator', 'planner', 'sales'];
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

const TABLE = { sales_document: 'sales_documents', production_order: 'orders', purchase_order: 'purchase_orders', subcontract_job: 'subcontract_jobs' };

async function summary(id) {
  const p = await db.get('SELECT p.*, c.name AS customer_name FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = ?', [id]);
  if (!p) return null;
  const links = await db.all('SELECT kind, ref_id FROM project_links WHERE project_id = ?', [id]);
  const ids = (k) => links.filter((l) => l.kind === k).map((l) => l.ref_id);

  const docs = ids('sales_document').length ? await db.all(`
    SELECT id, doc_type, number, status, locked, net_total, document_date FROM sales_documents WHERE id = ANY(?::int[]) ORDER BY id`, [ids('sales_document')]) : [];
  const sumDocs = (type) => r2(docs.filter((d) => d.doc_type === type && d.locked).reduce((s, d) => s + Number(d.net_total), 0));

  // Production orders: linked directly + made for linked order confirmations (root orders only)
  const viaOrders = docs.filter((d) => d.doc_type === 'order').length ? (await db.all(`
    SELECT DISTINCT o.id FROM orders o JOIN sales_document_lines sl ON sl.id = o.sales_line_id
    WHERE sl.document_id = ANY(?::int[]) AND o.parent_order_id IS NULL`, [docs.filter((d) => d.doc_type === 'order').map((d) => d.id)])).map((r) => r.id) : [];
  const prodIds = [...new Set([...ids('production_order'), ...viaOrders])];
  const production = [];
  for (const oid of prodIds) {
    const c = await costOrder(oid);
    if (c) production.push({ id: oid, product_name: c.order.product_name, status: c.order.status, quantity: c.order.quantity, planned: c.planned.total, actual: c.actual.total, external: c.actual.external });
  }

  const pos = ids('purchase_order').length ? await db.all(`
    SELECT po.id, po.po_number, po.status, s.name AS supplier_name,
           COALESCE((SELECT SUM(quantity_ordered * unit_price) FROM purchase_order_items WHERE po_id = po.id), 0) AS value
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ANY(?::int[])`, [ids('purchase_order')]) : [];
  // Outside processing linked on its own (not already inside a linked production order's costing)
  const jobs = ids('subcontract_job').length ? await db.all(`
    SELECT j.id, j.description, j.status, j.order_id, s.name AS supplier_name,
           CASE WHEN j.status = 'received' THEN j.actual_cost ELSE GREATEST(j.quantity * j.price_per_unit, j.min_charge) END AS cost
    FROM subcontract_jobs j JOIN suppliers s ON s.id = j.supplier_id WHERE j.id = ANY(?::int[])`, [ids('subcontract_job')]) : [];
  const extraJobs = jobs.filter((j) => !prodIds.includes(j.order_id));

  const cost = {
    production: r2(production.reduce((s, x) => s + Number(x.actual), 0)),
    purchases: r2(pos.filter((x) => x.status !== 'cancelled').reduce((s, x) => s + Number(x.value), 0)),
    outside_processing: r2(extraJobs.filter((x) => x.status !== 'cancelled').reduce((s, x) => s + Number(x.cost), 0)),
  };
  cost.total = r2(cost.production + cost.purchases + cost.outside_processing);
  const revenue = { quoted: sumDocs('quote'), ordered: sumDocs('order'), invoiced: r2(sumDocs('invoice') - sumDocs('credit_note')) };
  const basis = revenue.invoiced || revenue.ordered;
  return {
    ...p, revenue, cost,
    margin: r2(basis - cost.total), margin_percent: basis ? Math.round(((basis - cost.total) / basis) * 1000) / 10 : null,
    budget_used_percent: p.budget_cost ? Math.round((cost.total / Number(p.budget_cost)) * 100) : null,
    over_budget: !!(p.budget_cost && cost.total > Number(p.budget_cost)),
    documents: docs, production, purchase_orders: pos, subcontract_jobs: jobs,
  };
}

router.get('/', h(async (req, res) => {
  const q = v.query(req, v.z.object({ status: v.z.enum(['open', 'closed', 'all']).default('open') }));
  const rows = await db.all("SELECT id FROM projects WHERE (? = 'all' OR status = ?) ORDER BY id DESC LIMIT 200", [q.status, q.status]);
  res.json(await Promise.all(rows.map((r) => summary(r.id))));
}));

router.get('/:id', h(async (req, res) => {
  const s = await summary(v.paramId(req));
  if (!s) throw notFound('Project');
  res.json(s);
}));

const schema = v.z.object({
  name: v.z.string().trim().min(1).max(200), customer_id: v.optId,
  budget_cost: v.z.preprocess((x) => (x === '' || x === null ? undefined : x), v.z.coerce.number().min(0).optional()),
  budget_revenue: v.z.preprocess((x) => (x === '' || x === null ? undefined : x), v.z.coerce.number().min(0).optional()),
  due_date: v.optDate, notes: v.optStr(5000), status: v.z.enum(['open', 'closed', 'cancelled']).optional(),
});

router.post('/', requireRole(...EDITORS), h(async (req, res) => {
  const b = v.body(req, schema);
  const row = await db.get(`INSERT INTO projects (number, name, customer_id, budget_cost, budget_revenue, due_date, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?) RETURNING id`, [await nextNumber('project'), b.name, b.customer_id ?? null, b.budget_cost ?? null, b.budget_revenue ?? null, b.due_date ?? null, b.notes ?? null, req.user.id]);
  res.status(201).json(await summary(row.id));
}));

router.put('/:id', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const cur = await db.get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!cur) throw notFound('Project');
  const n = { ...cur, ...Object.fromEntries(Object.entries(v.body(req, schema.partial())).filter(([, x]) => x !== undefined)) };
  await db.run('UPDATE projects SET name=?, customer_id=?, budget_cost=?, budget_revenue=?, due_date=?, notes=?, status=? WHERE id=?',
    [n.name, n.customer_id, n.budget_cost, n.budget_revenue, n.due_date, n.notes, n.status, id]);
  res.json(await summary(id));
}));

// POST /api/projects/:id/links { kind, ref_id } — one record belongs to at most one project
router.post('/:id/links', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object({ kind: v.z.enum(Object.keys(TABLE)), ref_id: v.id }));
  if (!(await db.get('SELECT id FROM projects WHERE id = ?', [id]))) throw notFound('Project');
  if (!(await db.get(`SELECT id FROM ${TABLE[b.kind]} WHERE id = ?`, [b.ref_id]))) throw badRequest('Record not found');
  const taken = await db.get('SELECT project_id FROM project_links WHERE kind = ? AND ref_id = ?', [b.kind, b.ref_id]);
  if (taken && taken.project_id !== id) throw conflict('This record already belongs to another project');
  if (!taken) await db.run('INSERT INTO project_links (project_id, kind, ref_id) VALUES (?, ?, ?)', [id, b.kind, b.ref_id]);
  res.status(201).json(await summary(id));
}));

router.delete('/:id/links/:kind/:refId', requireRole(...EDITORS), h(async (req, res) => {
  const p = v.params(req, v.z.object({ id: v.z.coerce.number().int().positive(), kind: v.z.enum(Object.keys(TABLE)), refId: v.z.coerce.number().int().positive() }));
  await db.run('DELETE FROM project_links WHERE project_id = ? AND kind = ? AND ref_id = ?', [p.id, p.kind, p.refId]);
  res.json(await summary(p.id));
}));

module.exports = router;
