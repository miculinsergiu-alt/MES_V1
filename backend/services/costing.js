/**
 * Nachkalkulation: planned vs. actual cost of a production order.
 *
 * A production order is the root order plus its routing steps. Costs:
 *  - material: planned = BOM quantity × order quantity × unit cost;
 *              actual  = material really booked out for the order (at the
 *              unit cost of each stock movement)
 *  - machine:  hours × machine hourly rate (planned from the schedule,
 *              actual from setup and production times reported by operators)
 *  - labour:   hours × company labour rate (actual includes supervision)
 * Revenue comes from the sales order line the production order was made for,
 * else from the item's sales price.
 */
const db = require('../db');
const { parseLocal } = require('../lib/time');
const { unitCostOf } = require('./stock');

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const hours = (start, end) => {
  if (!start || !end) return 0;
  const ms = parseLocal(end) - parseLocal(start);
  return Number.isFinite(ms) && ms > 0 ? ms / 3600000 : 0;
};

/** Actual hours per order step from operator actions: { machine, labour }. */
async function actualHours(orderId, order) {
  const actions = await db.all(`
    SELECT oa.allocation_id, oa.action_type, oa.timestamp
    FROM operator_actions oa JOIN machine_allocations ma ON ma.id = oa.allocation_id
    WHERE ma.order_id = ?
    ORDER BY oa.allocation_id, oa.timestamp, oa.id`, [orderId]);
  let machine = 0; let labour = 0;
  const open = new Map(); // allocation:phase -> start
  for (const a of actions) {
    const [phase, edge] = a.action_type.split('_');
    if (!['setup', 'working', 'supervision'].includes(phase)) continue;
    const key = `${a.allocation_id}:${phase}`;
    if (edge === 'start') { open.set(key, a.timestamp); continue; }
    const start = open.get(key);
    if (!start) continue;
    open.delete(key);
    const h = hours(start, a.timestamp);
    labour += h;
    if (phase !== 'supervision') machine += h;
  }
  // Started but not ended (e.g. results booked without "end"): count up to the order end.
  for (const [key, start] of open) {
    const h = hours(start, order.actual_end);
    labour += h;
    if (!key.endsWith(':supervision')) machine += h;
  }
  // No operator times at all: fall back to the order's actual start/end.
  if (!actions.length && order.actual_start && order.actual_end) {
    machine = hours(order.actual_start, order.actual_end);
    labour = machine;
  }
  return { machine, labour };
}

async function costOrder(rootId) {
  const root = await db.get(`
    SELECT o.*, i.item_code, i.name AS item_name, i.unit_price AS sales_price
    FROM orders o LEFT JOIN items i ON i.id = o.item_id
    WHERE o.id = ? AND o.parent_order_id IS NULL`, [rootId]);
  if (!root) return null;
  const company = await db.get('SELECT labor_rate FROM companies WHERE id = nova_company_id()');
  const laborRate = Number(company?.labor_rate) || 0;

  const steps = await db.all(`
    SELECT o.id, o.machine_id, o.planned_start, o.planned_end, o.actual_start, o.actual_end, o.status, o.routing_sequence,
           m.name AS machine_name, m.hourly_rate
    FROM orders o JOIN machines m ON m.id = o.machine_id
    WHERE (o.id = ? OR o.parent_order_id = ?) AND o.status <> 'cancelled'
    ORDER BY o.routing_sequence, o.id`, [rootId, rootId]);

  const stepRows = [];
  for (const s of steps) {
    const planned = hours(s.planned_start, s.planned_end);
    const act = await actualHours(s.id, s);
    // Work was done but no usable times were reported (under one minute):
    // use the planned time, marked as estimated, rather than showing zero cost.
    const worked = s.status !== 'pending' || !!(await db.get('SELECT 1 AS x FROM production_results WHERE order_id = ? LIMIT 1', [s.id]));
    const estimated = worked && act.machine < 1 / 60 && planned > 0;
    if (estimated) { act.machine = planned; act.labour = Math.max(act.labour, planned); }
    const rate = Number(s.hourly_rate) || 0;
    stepRows.push({
      order_id: s.id, machine_name: s.machine_name, status: s.status, hourly_rate: rate, estimated,
      planned_hours: round2(planned), actual_machine_hours: round2(act.machine), actual_labour_hours: round2(act.labour),
      planned_machine_cost: round2(planned * rate), actual_machine_cost: round2(act.machine * rate),
      planned_labour_cost: round2(planned * laborRate), actual_labour_cost: round2(act.labour * laborRate),
    });
  }

  // Material
  const materials = [];
  if (root.bom_id) {
    const pos = await db.all(`
      SELECT bp.item_id, SUM(bp.quantity) AS qty, i.item_code, i.name, i.uom
      FROM bom_positions bp JOIN items i ON i.id = bp.item_id
      WHERE bp.bom_id = ? AND bp.node_type = 'component' AND bp.item_id IS NOT NULL
      GROUP BY bp.item_id, i.item_code, i.name, i.uom`, [root.bom_id]);
    for (const p of pos) {
      const unit = await unitCostOf(p.item_id);
      const plannedQty = Number(p.qty) * root.quantity;
      materials.push({ item_id: p.item_id, item_code: p.item_code, name: p.name, uom: p.uom,
        planned_qty: plannedQty, planned_cost: round2(plannedQty * unit), actual_qty: 0, actual_cost: 0 });
    }
  }
  const used = await db.all(`
    SELECT st.item_id, i.item_code, i.name, i.uom, -SUM(st.quantity) AS qty, -SUM(st.quantity * COALESCE(st.unit_cost, 0)) AS cost
    FROM stock_transactions st JOIN items i ON i.id = st.item_id
    WHERE st.reference_type = 'order_completion' AND st.reference_id = ?
    GROUP BY st.item_id, i.item_code, i.name, i.uom`, [rootId]);
  for (const u of used) {
    let m = materials.find((x) => x.item_id === u.item_id);
    if (!m) { m = { item_id: u.item_id, item_code: u.item_code, name: u.name, uom: u.uom, planned_qty: 0, planned_cost: 0 }; materials.push(m); }
    m.actual_qty = Number(u.qty);
    m.actual_cost = round2(u.cost);
  }

  // Output: good and scrap parts of the last step
  const last = steps[steps.length - 1];
  const out = last ? await db.get(`
    SELECT COALESCE(SUM(qty_ok), 0) AS ok, COALESCE(SUM(qty_fail), 0) AS fail FROM production_results WHERE order_id = ?`, [last.id]) : { ok: 0, fail: 0 };

  // Revenue
  let revenuePerPiece = Number(root.sales_price) || 0;
  let salesOrder = null;
  if (root.sales_line_id) {
    const line = await db.get(`
      SELECT sl.line_net, sl.quantity, sd.id, sd.number, sd.customer_name
      FROM sales_document_lines sl JOIN sales_documents sd ON sd.id = sl.document_id WHERE sl.id = ?`, [root.sales_line_id]);
    if (line && Number(line.quantity) > 0) {
      revenuePerPiece = Number(line.line_net) / Number(line.quantity);
      salesOrder = { id: line.id, number: line.number, customer_name: line.customer_name };
    }
  }

  const sum = (rows, k) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  const planned = {
    material: sum(materials, 'planned_cost'),
    machine: sum(stepRows, 'planned_machine_cost'),
    labour: sum(stepRows, 'planned_labour_cost'),
  };
  planned.total = round2(planned.material + planned.machine + planned.labour);
  planned.quantity = root.quantity;
  planned.per_piece = root.quantity ? round2(planned.total / root.quantity) : 0;
  planned.revenue = round2(revenuePerPiece * root.quantity);
  planned.margin = round2(planned.revenue - planned.total);

  const actual = {
    material: sum(materials, 'actual_cost'),
    machine: sum(stepRows, 'actual_machine_cost'),
    labour: sum(stepRows, 'actual_labour_cost'),
  };
  actual.total = round2(actual.material + actual.machine + actual.labour);
  actual.quantity = Number(out.ok);
  actual.scrap = Number(out.fail);
  actual.per_piece = actual.quantity ? round2(actual.total / actual.quantity) : 0;
  actual.revenue = round2(revenuePerPiece * actual.quantity);
  actual.margin = round2(actual.revenue - actual.total);
  const pct = (m, r) => (r ? Math.round((m / r) * 1000) / 10 : null);
  planned.margin_percent = pct(planned.margin, planned.revenue);
  actual.margin_percent = pct(actual.margin, actual.revenue);

  return {
    order: {
      id: root.id, product_name: root.product_name, item_id: root.item_id, item_code: root.item_code, item_name: root.item_name,
      quantity: root.quantity, status: last?.status === 'done' ? 'done' : root.status, planned_start: root.planned_start,
      actual_end: last?.actual_end || null, sales_order: salesOrder,
    },
    labor_rate: laborRate,
    planned, actual,
    deviation: round2(actual.total - planned.total),
    times_estimated: stepRows.some((s) => s.estimated),
    materials, steps: stepRows,
  };
}

/** Summary rows for production orders started in a period. */
async function listOrders({ from, to, status }) {
  const roots = await db.all(`
    SELECT id FROM orders
    WHERE parent_order_id IS NULL AND order_type = 'production' AND status <> 'cancelled'
      AND (?::text IS NULL OR planned_start::timestamp >= ?::date)
      AND (?::text IS NULL OR planned_start::timestamp < (?::date + 1))
    ORDER BY planned_start::timestamp DESC, id DESC
    LIMIT 300`, [from ?? null, from ?? null, to ?? null, to ?? null]);
  const out = [];
  for (const r of roots) {
    const c = await costOrder(r.id);
    if (!c || (status && c.order.status !== status)) continue;
    out.push({ ...c.order, planned: c.planned, actual: c.actual, deviation: c.deviation, times_estimated: c.times_estimated });
  }
  return out;
}

module.exports = { costOrder, listOrders, actualHours };
