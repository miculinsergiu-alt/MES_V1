/**
 * Management reports. Each report returns { columns, rows, totals } so the
 * same data can be shown on screen and exported to Excel.
 */
const XLSX = require('@e965/xlsx');
const db = require('../db');

const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

/**
 * Sales and gross margin from issued invoices minus credit notes, per
 * customer or per item. Cost of goods = quantity × current unit cost
 * (moving average, else purchase / production cost).
 */
async function salesMargin({ from, to, groupBy = 'customer' }) {
  const lines = await db.all(`
    SELECT sd.doc_type, sd.customer_id, sd.customer_name, sl.item_id, COALESCE(i.item_code, sl.item_code) AS item_code,
           COALESCE(i.name, sl.description) AS item_name, sl.quantity, sl.line_net,
           CASE WHEN COALESCE(i.avg_cost, 0) > 0 THEN i.avg_cost
                WHEN i.type = 'raw_material' THEN i.acquisition_cost
                ELSE COALESCE(NULLIF(i.production_cost, 0), i.acquisition_cost, 0) END AS unit_cost
    FROM sales_document_lines sl
    JOIN sales_documents sd ON sd.id = sl.document_id
    LEFT JOIN items i ON i.id = sl.item_id
    WHERE sd.doc_type IN ('invoice','credit_note') AND sd.number IS NOT NULL AND sd.status <> 'cancelled'
      AND sd.document_date >= ? AND sd.document_date <= ?`, [from, to]);

  const groups = new Map();
  for (const l of lines) {
    const sign = l.doc_type === 'credit_note' ? -1 : 1;
    const key = groupBy === 'item' ? (l.item_id ? `i${l.item_id}` : `d${l.item_name}`) : `c${l.customer_id}`;
    const g = groups.get(key) || (groupBy === 'item'
      ? { item_code: l.item_code || '', item_name: l.item_name, quantity: 0, revenue: 0, cost: 0 }
      : { customer_name: l.customer_name, invoices: new Set(), revenue: 0, cost: 0 });
    g.revenue += sign * Number(l.line_net);
    // Free-text lines (freight, services without item) have no cost of goods.
    if (l.item_id) g.cost += sign * Number(l.quantity) * Number(l.unit_cost || 0);
    if (groupBy === 'item') g.quantity += sign * Number(l.quantity);
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => {
    const row = { ...g, revenue: r2(g.revenue), cost: r2(g.cost), margin: r2(g.revenue - g.cost) };
    row.margin_percent = row.revenue ? Math.round((row.margin / row.revenue) * 1000) / 10 : null;
    if (row.invoices) delete row.invoices;
    return row;
  }).sort((a, b) => b.revenue - a.revenue);

  const totals = { revenue: r2(rows.reduce((s, r) => s + r.revenue, 0)), cost: r2(rows.reduce((s, r) => s + r.cost, 0)) };
  totals.margin = r2(totals.revenue - totals.cost);
  totals.margin_percent = totals.revenue ? Math.round((totals.margin / totals.revenue) * 1000) / 10 : null;
  const columns = groupBy === 'item'
    ? ['item_code', 'item_name', 'quantity', 'revenue', 'cost', 'margin', 'margin_percent']
    : ['customer_name', 'revenue', 'cost', 'margin', 'margin_percent'];
  return { columns, rows, totals };
}

/** Stock value per item at current unit cost. */
async function stockValue() {
  const rows = (await db.all(`
    SELECT i.item_code, i.name AS item_name, i.type, i.uom, COALESCE(s.quantity, 0) AS quantity,
           COALESCE(s.allocated_quantity, 0) AS allocated,
           COALESCE((SELECT SUM(il.quantity) FROM inventory_lots il WHERE il.item_id = i.id AND il.owner_customer_id IS NOT NULL AND il.quantity > 0), 0) AS customer_owned,
           CASE WHEN COALESCE(i.avg_cost, 0) > 0 THEN i.avg_cost
                WHEN i.type = 'raw_material' THEN i.acquisition_cost
                ELSE COALESCE(NULLIF(i.production_cost, 0), i.acquisition_cost, 0) END AS unit_cost
    FROM items i LEFT JOIN stock_levels s ON s.item_id = i.id
    WHERE COALESCE(s.quantity, 0) <> 0
    ORDER BY i.type, i.item_code`)).map((r) => ({
    // Negative stock (bookings ahead of a stock count) is not an asset: valued at 0, but listed.
    // Customer-supplied material belongs to the customer: not part of our stock value.
    ...r, customer_owned: Number(r.customer_owned), unit_cost: Math.round(Number(r.unit_cost || 0) * 10000) / 10000,
    value: r2(Math.max(0, Number(r.quantity) - Number(r.customer_owned)) * Number(r.unit_cost || 0)),
  }));
  const byType = {};
  for (const r of rows) byType[r.type || 'other'] = r2((byType[r.type || 'other'] || 0) + r.value);
  return {
    columns: ['item_code', 'item_name', 'type', 'quantity', 'uom', 'unit_cost', 'value'],
    rows,
    totals: { value: r2(rows.reduce((s, r) => s + r.value, 0)), by_type: byType, negative_items: rows.filter((r) => r.quantity < 0).length },
  };
}

/**
 * On-time delivery (Liefertreue): sales orders with a requested delivery
 * date in the period. On time = everything delivered by that date.
 */
async function onTimeDelivery({ from, to }) {
  const orders = await db.all(`
    SELECT o.id, o.number, o.customer_name, o.delivery_date, o.status,
           (SELECT COALESCE(SUM(quantity), 0) FROM sales_document_lines WHERE document_id = o.id AND item_id IS NOT NULL) AS ordered,
           (SELECT COALESCE(SUM(delivered_quantity), 0) FROM sales_document_lines WHERE document_id = o.id AND item_id IS NOT NULL) AS delivered,
           (SELECT MAX(d.document_date) FROM sales_documents d WHERE d.source_document_id = o.id AND d.doc_type = 'delivery' AND d.number IS NOT NULL) AS last_delivery
    FROM sales_documents o
    WHERE o.doc_type = 'order' AND o.number IS NOT NULL AND o.status NOT IN ('cancelled', 'declined')
      AND o.delivery_date IS NOT NULL AND o.delivery_date >= ? AND o.delivery_date <= ?
    ORDER BY o.delivery_date, o.id`, [from, to]);
  const today = (await db.get('SELECT nova_today() AS d')).d;
  const rows = orders.map((o) => {
    const complete = Number(o.delivered) >= Number(o.ordered) && Number(o.ordered) > 0;
    let state;
    if (complete) state = o.last_delivery <= o.delivery_date ? 'on_time' : 'late';
    else state = o.delivery_date < today ? 'overdue' : 'open';
    const daysLate = complete && state === 'late'
      ? Math.round((Date.parse(o.last_delivery) - Date.parse(o.delivery_date)) / 86400000)
      : state === 'overdue' ? Math.round((Date.parse(today) - Date.parse(o.delivery_date)) / 86400000) : 0;
    return { number: o.number, customer_name: o.customer_name, delivery_date: o.delivery_date, last_delivery: o.last_delivery,
      ordered: Number(o.ordered), delivered: Number(o.delivered), state, days_late: daysLate, id: o.id };
  });
  const due = rows.filter((r) => r.state !== 'open');
  const onTime = due.filter((r) => r.state === 'on_time').length;
  return {
    columns: ['number', 'customer_name', 'delivery_date', 'last_delivery', 'ordered', 'delivered', 'state', 'days_late'],
    rows,
    totals: { orders: rows.length, due: due.length, on_time: onTime, rate: due.length ? Math.round((onTime / due.length) * 1000) / 10 : null },
  };
}

/** Excel workbook from a report; labels = { column: heading }. */
function toXlsx(report, { sheet = 'Report', labels = {}, title } = {}) {
  const head = report.columns.map((c) => labels[c] || c);
  const data = report.rows.map((r) => report.columns.map((c) => (r[c] === null || r[c] === undefined ? '' : r[c])));
  const aoa = title ? [[title], [], head, ...data] : [head, ...data];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = report.columns.map((c, i) => ({ wch: Math.min(50, Math.max(10, String(head[i]).length + 2, ...data.map((d) => String(d[i]).length + 1))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { salesMargin, stockValue, onTimeDelivery, toXlsx };
