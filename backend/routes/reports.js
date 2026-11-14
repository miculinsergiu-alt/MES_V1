const express = require('express');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const reports = require('../services/reports');
const costing = require('../services/costing');

const router = express.Router();
router.use(authenticateToken);

const MANAGERS = ['administrator', 'planner', 'accounting'];
const year = new Date().getFullYear();
const period = v.z.object({
  from: v.date.default(`${year}-01-01`),
  to: v.date.default(`${year}-12-31`),
  format: v.z.enum(['json', 'xlsx']).default('json'),
  group_by: v.z.enum(['customer', 'item']).default('customer'),
  lang: v.z.enum(['de', 'en']).default('de'),
});

// Column headings for the Excel files
const LABELS = {
  de: {
    customer_name: 'Kunde', item_code: 'Artikelnr.', item_name: 'Bezeichnung', quantity: 'Menge', revenue: 'Umsatz netto (€)',
    cost: 'Wareneinsatz (€)', margin: 'Rohertrag (€)', margin_percent: 'Rohertrag %', type: 'Art', uom: 'Einheit',
    unit_cost: 'Stückkosten (€)', value: 'Bestandswert (€)', number: 'Auftrag', delivery_date: 'Wunschtermin',
    last_delivery: 'Letzte Lieferung', ordered: 'Bestellt', delivered: 'Geliefert', state: 'Status', days_late: 'Tage Verzug',
    id: 'FA-Nr.', product_name: 'Produkt', status: 'Status', planned_total: 'Plankosten (€)', actual_total: 'Istkosten (€)',
    deviation: 'Abweichung (€)', actual_quantity: 'Gutmenge', actual_per_piece: 'Ist je Stück (€)', actual_margin: 'Ist-Deckungsbeitrag (€)',
  },
  en: {
    customer_name: 'Customer', item_code: 'Item no.', item_name: 'Description', quantity: 'Quantity', revenue: 'Net revenue (€)',
    cost: 'Cost of goods (€)', margin: 'Gross margin (€)', margin_percent: 'Margin %', type: 'Type', uom: 'Unit',
    unit_cost: 'Unit cost (€)', value: 'Stock value (€)', number: 'Order', delivery_date: 'Requested date',
    last_delivery: 'Last delivery', ordered: 'Ordered', delivered: 'Delivered', state: 'State', days_late: 'Days late',
    id: 'Order no.', product_name: 'Product', status: 'Status', planned_total: 'Planned cost (€)', actual_total: 'Actual cost (€)',
    deviation: 'Deviation (€)', actual_quantity: 'Good qty', actual_per_piece: 'Actual per piece (€)', actual_margin: 'Actual margin (€)',
  },
};
const TITLES = {
  de: { sales: 'Umsatz & Rohertrag', stock: 'Lagerbestandswert', delivery: 'Liefertreue', costing: 'Nachkalkulation' },
  en: { sales: 'Sales & margin', stock: 'Stock value', delivery: 'On-time delivery', costing: 'Actual costing' },
};

function send(res, q, kind, report, extraTitle = '') {
  if (q.format !== 'xlsx') return res.json(report);
  const title = `${TITLES[q.lang][kind]}${extraTitle}`;
  const buf = reports.toXlsx(report, { sheet: TITLES[q.lang][kind], labels: LABELS[q.lang], title });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}_${q.from}_${q.to}.xlsx"`);
  return res.send(buf);
}

// GET /api/reports/sales?from&to&group_by=customer|item&format=json|xlsx
router.get('/sales', requireRole(...MANAGERS, 'sales'), h(async (req, res) => {
  const q = v.query(req, period);
  send(res, q, 'sales', await reports.salesMargin({ from: q.from, to: q.to, groupBy: q.group_by }), ` ${q.from} – ${q.to}`);
}));

// GET /api/reports/stock-value
router.get('/stock-value', requireRole(...MANAGERS, 'warehouse_manager', 'material_planner'), h(async (req, res) => {
  const q = v.query(req, period);
  send(res, q, 'stock', await reports.stockValue());
}));

// GET /api/reports/on-time-delivery?from&to
router.get('/on-time-delivery', requireRole(...MANAGERS, 'sales'), h(async (req, res) => {
  const q = v.query(req, period);
  send(res, q, 'delivery', await reports.onTimeDelivery({ from: q.from, to: q.to }), ` ${q.from} – ${q.to}`);
}));

// GET /api/reports/costing?from&to — production orders, planned vs actual
router.get('/costing', requireRole(...MANAGERS), h(async (req, res) => {
  const q = v.query(req, period.extend({ status: v.z.enum(['pending', 'active', 'done']).optional() }));
  const rows = await costing.listOrders({ from: q.from, to: q.to, status: q.status });
  if (q.format !== 'xlsx') return res.json(rows);
  const flat = rows.map((r) => ({
    id: r.id, product_name: r.product_name, quantity: r.quantity, status: r.status,
    planned_total: r.planned.total, actual_total: r.actual.total, deviation: r.deviation,
    actual_quantity: r.actual.quantity, actual_per_piece: r.actual.per_piece, actual_margin: r.actual.margin,
  }));
  return send(res, q, 'costing', {
    columns: ['id', 'product_name', 'quantity', 'status', 'planned_total', 'actual_total', 'deviation', 'actual_quantity', 'actual_per_piece', 'actual_margin'],
    rows: flat,
  }, ` ${q.from} – ${q.to}`);
}));

// GET /api/reports/costing/:id — one production order in detail
router.get('/costing/:id', requireRole(...MANAGERS), h(async (req, res) => {
  const c = await costing.costOrder(v.paramId(req));
  if (!c) throw notFound('Production order');
  res.json(c);
}));

module.exports = router;
