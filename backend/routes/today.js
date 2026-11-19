/**
 * "Today": one list of everything that needs action, from all modules,
 * filtered by the user's roles. Each entry links to the screen to fix it.
 */
const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const { authenticateToken, hasRole } = require('../middleware/auth');
const { nowLocal, todayLocal } = require('../lib/time');

const router = express.Router();
router.use(authenticateToken);

const PROD = ['administrator', 'planner', 'area_supervisor', 'shift_responsible'];
const QUALITY = ['administrator', 'planner', 'area_supervisor', 'warehouse_manager', 'material_planner'];
const BUY = ['administrator', 'material_planner', 'warehouse_manager', 'planner'];
const SALES = ['administrator', 'sales', 'accounting'];
const PEOPLE = ['administrator', 'area_supervisor', 'shift_responsible', 'accounting'];

const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

router.get('/', h(async (req, res) => {
  const u = req.user;
  const now = nowLocal(u.timezone);
  const today = todayLocal(u.timezone);
  const out = [];
  const add = (category, severity, rows, map) => { for (const r of rows) out.push({ category, severity, ...map(r) }); };

  if (hasRole(u, ...PROD)) {
    add('late_orders', 'high', await db.all(`
      SELECT id, product_name, planned_end FROM orders
      WHERE status IN ('pending','active') AND order_type = 'production' AND planned_end::timestamp < ?::timestamp
      ORDER BY planned_end LIMIT 50`, [now]), (r) => ({ id: r.id, title: r.product_name, date: r.planned_end, link: '/planner' }));
    add('quality_hold', 'high', await db.all(`
      SELECT id, product_name FROM orders WHERE quality_hold = 1 AND status <> 'cancelled' LIMIT 50`), (r) => ({ id: r.id, title: r.product_name, link: '/planner' }));
    add('material_short', 'medium', await db.all(`
      SELECT DISTINCT o.id, o.product_name, o.planned_start, i.item_code
      FROM orders o JOIN bom_positions bp ON bp.bom_id = o.bom_id AND bp.node_type = 'component' AND bp.item_id IS NOT NULL
      JOIN items i ON i.id = bp.item_id LEFT JOIN stock_levels s ON s.item_id = bp.item_id
      WHERE o.parent_order_id IS NULL AND o.status = 'pending' AND o.planned_start::date <= ?::date
        AND COALESCE(s.quantity, 0) < bp.quantity * o.quantity
      ORDER BY o.planned_start LIMIT 50`, [addDays(today, 7)]), (r) => ({ id: r.id, title: `${r.product_name}: ${r.item_code}`, date: r.planned_start, link: '/inventory' }));
    add('subcontract_overdue', 'medium', await db.all(`
      SELECT j.id, j.description, j.planned_return, s.name AS supplier FROM subcontract_jobs j JOIN suppliers s ON s.id = j.supplier_id
      WHERE j.status = 'sent' AND j.planned_return::timestamp < ?::timestamp ORDER BY j.planned_return LIMIT 50`, [now]),
    (r) => ({ id: r.id, title: `${r.description} · ${r.supplier}`, date: r.planned_return, link: '/subcontracting' }));
    add('subcontract_to_send', 'low', await db.all(`
      SELECT j.id, j.description, j.planned_send, s.name AS supplier FROM subcontract_jobs j JOIN suppliers s ON s.id = j.supplier_id
      WHERE j.status = 'planned' AND j.planned_send::date <= ?::date ORDER BY j.planned_send LIMIT 50`, [today]),
    (r) => ({ id: r.id, title: `${r.description} · ${r.supplier}`, date: r.planned_send, link: '/subcontracting' }));
  }
  if (hasRole(u, ...QUALITY)) {
    add('quarantine', 'medium', await db.all(`
      SELECT q.id, q.lot_number, q.reason, i.item_code FROM quarantine_logs q JOIN items i ON i.id = q.item_id WHERE q.status = 'pending' ORDER BY q.id LIMIT 50`),
    (r) => ({ id: r.id, title: `${r.item_code} · ${r.lot_number} · ${r.reason}`, link: `/trace/${encodeURIComponent(r.lot_number)}` }));
    add('gauges_due', 'medium', await db.all(`
      SELECT id, code, name, next_due FROM gauges WHERE active = 1 AND next_due IS NOT NULL AND next_due <= ? ORDER BY next_due LIMIT 50`, [addDays(today, 14)]),
    (r) => ({ id: r.id, title: `${r.code} · ${r.name}`, date: r.next_due, overdue: r.next_due < today, link: '/quality' }));
    add('complaints_due', 'high', await db.all(`
      SELECT id, number, description, due_date FROM complaints WHERE status IN ('open','analysis','action') AND due_date IS NOT NULL AND due_date <= ? ORDER BY due_date LIMIT 50`, [today]),
    (r) => ({ id: r.id, title: `${r.number} · ${r.description}`, date: r.due_date, link: '/quality' }));
  }
  if (hasRole(u, ...BUY)) {
    add('po_overdue', 'medium', await db.all(`
      SELECT po.id, po.po_number, po.expected_date, s.name AS supplier FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.status IN ('ordered','partial') AND po.po_type = 'material' AND po.expected_date IS NOT NULL AND po.expected_date < ? ORDER BY po.expected_date LIMIT 50`, [today]),
    (r) => ({ id: r.id, title: `${r.po_number} · ${r.supplier}`, date: r.expected_date, link: '/inventory' }));
  }
  if (hasRole(u, ...SALES)) {
    add('invoices_overdue', 'medium', await db.all(`
      SELECT id, number, customer_name, due_date, gross_total - paid_total - credited_total AS open FROM sales_documents
      WHERE doc_type = 'invoice' AND locked = 1 AND status IN ('issued','partially_paid') AND due_date IS NOT NULL AND due_date < ?
      ORDER BY due_date LIMIT 50`, [today]), (r) => ({ id: r.id, title: `${r.number} · ${r.customer_name}`, date: r.due_date, amount: Number(r.open), link: `/sales/documents/${r.id}` }));
    add('deliveries_due', 'medium', await db.all(`
      SELECT id, number, customer_name, delivery_date FROM sales_documents
      WHERE doc_type = 'order' AND locked = 1 AND status IN ('issued','accepted','partially_delivered') AND delivery_date IS NOT NULL AND delivery_date <= ?
      ORDER BY delivery_date LIMIT 50`, [addDays(today, 3)]), (r) => ({ id: r.id, title: `${r.number} · ${r.customer_name}`, date: r.delivery_date, overdue: r.delivery_date < today, link: `/sales/documents/${r.id}` }));
    add('quotes_expiring', 'low', await db.all(`
      SELECT sd.id, sd.number, sd.customer_name, sd.valid_until FROM sales_documents sd LEFT JOIN quote_outcomes qo ON qo.document_id = sd.id
      WHERE sd.doc_type = 'quote' AND sd.locked = 1 AND sd.status = 'issued' AND qo.id IS NULL AND sd.valid_until IS NOT NULL
        AND sd.valid_until BETWEEN ? AND ? ORDER BY sd.valid_until LIMIT 50`, [today, addDays(today, 7)]),
    (r) => ({ id: r.id, title: `${r.number} · ${r.customer_name}`, date: r.valid_until, link: `/sales/documents/${r.id}` }));
  }
  if (hasRole(u, ...PEOPLE)) {
    add('forgot_clock_out', 'low', await db.all(`
      SELECT te.id, te.clock_in, u.first_name || ' ' || u.last_name AS name FROM time_entries te JOIN users u ON u.id = te.user_id
      WHERE te.clock_out IS NULL AND te.clock_in::date < ?::date ORDER BY te.clock_in LIMIT 50`, [today]),
    (r) => ({ id: r.id, title: r.name, date: r.clock_in, link: '/time' }));
  }
  // Everyone: own forgotten clock-out
  const mine = await db.get('SELECT id, clock_in FROM time_entries WHERE user_id = ? AND clock_out IS NULL AND clock_in::date < ?::date', [u.id, today]);
  if (mine && !hasRole(u, ...PEOPLE)) out.push({ category: 'forgot_clock_out', severity: 'low', id: mine.id, title: u.first_name, date: mine.clock_in, link: '/time' });

  const rank = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.date || '').localeCompare(String(b.date || '')));
  const counts = {};
  for (const x of out) counts[x.category] = (counts[x.category] || 0) + 1;
  res.json({ today, total: out.length, counts, items: out });
}));

module.exports = router;
