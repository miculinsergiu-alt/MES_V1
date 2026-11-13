/**
 * Home dashboard (key figures per role) and global search.
 */
const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { authenticateToken } = require('../middleware/auth');
const { missingInvoiceData } = require('./settings');

const router = express.Router();
router.use(authenticateToken);

// Who sees which part (mirrors the navigation in the frontend).
const ACCESS = {
  production: ['administrator', 'planner', 'area_supervisor', 'shift_responsible'],
  maintenance: ['administrator', 'area_supervisor'],
  inventory: ['administrator', 'planner', 'warehouse_manager', 'material_planner'],
  sales: ['administrator', 'sales', 'accounting', 'planner'],
  accounting: ['administrator', 'accounting'],
  incoming: ['administrator', 'accounting', 'material_planner', 'planner', 'warehouse_manager'],
  items: ['administrator', 'planner'],
  customers: ['administrator', 'sales', 'accounting', 'planner'],
  suppliers: ['administrator', 'planner', 'warehouse_manager', 'material_planner', 'accounting'],
  setup: ['administrator'],
};
const can = (role, area) => ACCESS[area].includes(role);

// GET /api/dashboard — key figures for the logged-in user's role
router.get('/dashboard', h(async (req, res) => {
  const role = req.user.role;
  const out = {};
  const today = (await db.get('SELECT nova_today() AS d')).d;

  if (can(role, 'production')) {
    out.production = await db.get(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active_orders,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_orders,
        COUNT(*) FILTER (WHERE status IN ('pending','active') AND planned_start::timestamp::date = ?::date) AS planned_today,
        COUNT(*) FILTER (WHERE status IN ('pending','active') AND planned_end::timestamp < LOCALTIMESTAMP) AS late_orders,
        COUNT(*) FILTER (WHERE status = 'done' AND actual_end::timestamp::date = ?::date) AS done_today
      FROM orders WHERE order_type = 'production'`, [today, today]);
    out.production.delay_minutes_today = (await db.get(
      "SELECT COALESCE(SUM(delay_minutes), 0) AS m FROM order_delays WHERE applied = 1 AND created_at::timestamp::date = ?::date", [today])).m;
  }
  if (can(role, 'maintenance')) {
    out.maintenance = await db.get(`
      SELECT COUNT(*) AS due FROM machines m JOIN machine_maintenance_config c ON c.machine_id = m.id
      WHERE m.active = 1 AND (m.total_running_hours - c.last_maintenance_hours) >= c.interval_hours`);
  }
  if (can(role, 'inventory')) {
    out.inventory = await db.get(`
      SELECT
        (SELECT COUNT(*) FROM purchase_recommendations WHERE status = 'pending') AS purchase_recommendations,
        (SELECT COUNT(*) FROM purchase_orders WHERE status IN ('ordered','partial')) AS open_purchase_orders,
        (SELECT COUNT(*) FROM quarantine_logs WHERE status = 'pending') AS quarantine,
        (SELECT COUNT(*) FROM stock_levels WHERE quantity < 0) AS negative_stock`);
  }
  if (can(role, 'sales')) {
    out.sales = await db.get(`
      SELECT
        COUNT(*) FILTER (WHERE doc_type = 'quote' AND status = 'issued') AS open_quotes,
        COUNT(*) FILTER (WHERE doc_type = 'order' AND status IN ('issued','partially_delivered')) AS orders_to_deliver,
        COUNT(*) FILTER (WHERE doc_type = 'invoice' AND status IN ('issued','partially_paid')) AS open_invoices,
        COALESCE(SUM(gross_total - paid_total - credited_total) FILTER (WHERE doc_type = 'invoice' AND status IN ('issued','partially_paid')), 0) AS open_amount,
        COALESCE(SUM(gross_total - paid_total - credited_total) FILTER (WHERE doc_type = 'invoice' AND status IN ('issued','partially_paid') AND due_date < ?), 0) AS overdue_amount,
        COUNT(*) FILTER (WHERE doc_type = 'invoice' AND status IN ('issued','partially_paid') AND due_date < ?) AS overdue_invoices,
        COALESCE(SUM(net_total) FILTER (WHERE doc_type = 'invoice' AND locked = 1 AND document_date >= date_trunc('month', ?::date)::date::text), 0)
          - COALESCE(SUM(net_total) FILTER (WHERE doc_type = 'credit_note' AND locked = 1 AND document_date >= date_trunc('month', ?::date)::date::text), 0) AS revenue_month
      FROM sales_documents`, [today, today, today, today]);
  }
  if (can(role, 'incoming')) {
    out.incoming = await db.get("SELECT COUNT(*) AS to_approve, COALESCE(SUM(gross_total), 0) AS amount FROM purchase_invoices WHERE status = 'received'");
  }
  if (can(role, 'setup')) {
    const company = await db.get('SELECT * FROM companies WHERE id = nova_company_id()');
    const counts = await db.get(`
      SELECT (SELECT COUNT(*) FROM machines WHERE active = 1) AS machines, (SELECT COUNT(*) FROM items WHERE active = 1) AS items,
             (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM users WHERE active = 1) AS users,
             (SELECT COUNT(*) FROM warehouses) AS warehouses`);
    out.setup = {
      company_data_complete: missingInvoiceData(company).length === 0,
      bank_details: !!company.iban,
      has_machines: counts.machines > 0,
      has_items: counts.items > 0,
      has_customers: counts.customers > 0,
      has_users: counts.users > 1,
      has_warehouse: counts.warehouses > 0,
    };
  }
  res.json(out);
}));

// GET /api/search?q=... — quick search across the main records
router.get('/search', h(async (req, res) => {
  const { q } = v.query(req, v.z.object({ q: v.z.string().trim().min(2).max(100) }));
  const role = req.user.role;
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const results = [];
  const LIMIT = 6;

  if (can(role, 'items')) {
    for (const r of await db.all(`SELECT id, item_code, name, type FROM items WHERE active = 1 AND (item_code ILIKE ? OR name ILIKE ?) ORDER BY item_code LIMIT ${LIMIT}`, [like, like])) {
      results.push({ type: 'item', id: r.id, title: `${r.item_code} · ${r.name}`, subtitle: r.type, path: `/planner/items?search=${encodeURIComponent(r.item_code)}` });
    }
  }
  if (can(role, 'customers')) {
    for (const r of await db.all(`SELECT id, customer_number, name, city FROM customers WHERE name ILIKE ? OR customer_number ILIKE ? OR city ILIKE ? ORDER BY name LIMIT ${LIMIT}`, [like, like, like])) {
      results.push({ type: 'customer', id: r.id, title: r.name, subtitle: [r.customer_number, r.city].filter(Boolean).join(' · '), path: `/sales/customers?search=${encodeURIComponent(r.name)}` });
    }
  }
  if (can(role, 'suppliers')) {
    for (const r of await db.all(`SELECT id, name, vat_number FROM suppliers WHERE name ILIKE ? OR vat_number ILIKE ? ORDER BY name LIMIT ${LIMIT}`, [like, like])) {
      results.push({ type: 'supplier', id: r.id, title: r.name, subtitle: r.vat_number, path: `/inventory/suppliers?search=${encodeURIComponent(r.name)}` });
    }
  }
  if (can(role, 'sales')) {
    for (const r of await db.all(`
      SELECT id, doc_type, number, customer_name, document_date, gross_total FROM sales_documents
      WHERE number ILIKE ? OR customer_name ILIKE ? OR customer_reference ILIKE ?
      ORDER BY document_date DESC, id DESC LIMIT ${LIMIT}`, [like, like, like])) {
      results.push({ type: 'document', id: r.id, title: `${r.number || '—'} · ${r.customer_name}`, subtitle: `${r.doc_type} · ${r.document_date}`, path: `/sales/documents/${r.id}` });
    }
  }
  if (can(role, 'production')) {
    const idMatch = /^\d+$/.test(q) ? Number(q) : -1;
    const base = role === 'shift_responsible' ? '/shift' : role === 'area_supervisor' ? '/supervisor' : '/planner';
    for (const r of await db.all(`
      SELECT id, product_name, status, planned_start FROM orders
      WHERE (product_name ILIKE ? OR id = ?) AND parent_order_id IS NULL
      ORDER BY planned_start::timestamp DESC LIMIT ${LIMIT}`, [like, idMatch])) {
      results.push({ type: 'order', id: r.id, title: `#${r.id} · ${r.product_name}`, subtitle: `${r.status} · ${r.planned_start}`, path: base });
    }
  }
  if (can(role, 'incoming')) {
    for (const r of await db.all(`
      SELECT id, invoice_number, seller_name, gross_total FROM purchase_invoices
      WHERE invoice_number ILIKE ? OR seller_name ILIKE ? ORDER BY received_at DESC LIMIT ${LIMIT}`, [like, like])) {
      results.push({ type: 'purchase_invoice', id: r.id, title: `${r.invoice_number} · ${r.seller_name}`, subtitle: `${r.gross_total} EUR`, path: `/purchase-invoices?id=${r.id}` });
    }
  }
  res.json(results);
}));

module.exports = router;
module.exports.ACCESS = ACCESS;
