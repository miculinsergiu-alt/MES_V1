/**
 * Batch traceability (Chargenrückverfolgung).
 *
 * Backward: from a lot to the materials it was made of, down to the
 *           supplier deliveries (which supplier, which goods receipt).
 * Forward:  from a lot to the production orders that used it, the lots
 *           those produced, and the customer deliveries that shipped them.
 *
 * Used for complaints and recalls: "which customers received parts made
 * from steel lot X?" and "where did the material of this part come from?".
 */
const db = require('../db');

const MAX_DEPTH = 12;

async function lotById(id) {
  return db.get(`
    SELECT il.id, il.lot_number, il.item_id, il.quantity, il.source_type, il.production_order_id,
           il.expiration_date, il.created_at, i.item_code, i.name AS item_name, i.uom
    FROM inventory_lots il JOIN items i ON i.id = il.item_id
    WHERE il.id = ?`, [id]);
}

async function lotByNumber(lotNumber) {
  const l = await db.get('SELECT id FROM inventory_lots WHERE lot_number = ?', [lotNumber]);
  return l ? lotById(l.id) : null;
}

async function productionOrder(orderId) {
  if (!orderId) return null;
  return db.get(`
    SELECT o.id, o.product_name, o.quantity, o.status, o.actual_end, o.planned_start,
           sd.id AS sales_order_id, sd.number AS sales_order_number, sd.customer_name
    FROM orders o
    LEFT JOIN sales_document_lines sl ON sl.id = o.sales_line_id
    LEFT JOIN sales_documents sd ON sd.id = sl.document_id
    WHERE o.id = ?`, [orderId]);
}

async function receiptsOf(lot) {
  return db.all(`
    SELECT gr.id AS receipt_id, gr.received_at, gr.document_reference, gr.po_id, po.po_number,
           s.id AS supplier_id, s.name AS supplier_name, gri.quantity_received AS quantity, gri.quality_status
    FROM goods_receipt_items gri
    JOIN goods_receipts gr ON gr.id = gri.receipt_id
    LEFT JOIN purchase_orders po ON po.id = gr.po_id
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE gri.lot_number = ? AND gri.item_id = ?
    ORDER BY gr.received_at, gr.id`, [lot.lot_number, lot.item_id]);
}

/** Where the lot came from, recursively through the materials of production lots. */
async function backward(lot, depth = 0, seen = new Set()) {
  const node = { lot, origin: null, materials: [] };
  if (seen.has(lot.id) || depth > MAX_DEPTH) return { ...node, truncated: true };
  seen.add(lot.id);

  if (lot.production_order_id) {
    node.origin = { type: 'production', order: await productionOrder(lot.production_order_id) };
    const used = await db.all(`
      SELECT lot_id, SUM(quantity_used) AS quantity FROM order_material_lots
      WHERE order_id = ? GROUP BY lot_id ORDER BY MIN(id)`, [lot.production_order_id]);
    for (const u of used) {
      const m = await lotById(u.lot_id);
      if (m) node.materials.push({ quantity: u.quantity, ...(await backward(m, depth + 1, seen)) });
    }
  } else {
    node.origin = { type: lot.source_type || 'receipt', receipts: await receiptsOf(lot) };
  }
  return node;
}

/** Where the lot went, recursively through the lots produced from it. */
async function forward(lot, depth = 0, seen = new Set()) {
  const node = { lot, usage: [] };
  if (seen.has(lot.id) || depth > MAX_DEPTH) return { ...node, truncated: true };
  seen.add(lot.id);

  const moves = await db.all(`
    SELECT reference_type, reference_id, -SUM(quantity) AS quantity, MIN(created_at) AS date
    FROM stock_transactions
    WHERE lot_id = ? AND type = 'out'
    GROUP BY reference_type, reference_id
    ORDER BY MIN(created_at), MIN(id)`, [lot.id]);

  for (const m of moves) {
    if (m.reference_type === 'order_completion') {
      const order = await productionOrder(m.reference_id);
      const products = await db.all('SELECT id FROM inventory_lots WHERE production_order_id = ? ORDER BY id', [m.reference_id]);
      const produced = [];
      for (const p of products) produced.push(await forward(await lotById(p.id), depth + 1, seen));
      node.usage.push({ type: 'production', quantity: m.quantity, date: m.date, order, produced });
    } else if (m.reference_type === 'delivery') {
      const doc = await db.get(`
        SELECT id, number, document_date, customer_id, customer_name FROM sales_documents WHERE id = ?`, [m.reference_id]);
      node.usage.push({ type: 'delivery', quantity: m.quantity, date: m.date, delivery: doc });
    } else {
      node.usage.push({ type: m.reference_type || 'other', quantity: m.quantity, date: m.date, reference_id: m.reference_id });
    }
  }
  return node;
}

/** Flat summaries for recalls: affected customers (forward) and suppliers (backward). */
function collect(tree, kind, out = new Map()) {
  if (kind === 'customers') {
    for (const u of tree.usage || []) {
      if (u.type === 'delivery' && u.delivery) {
        const k = u.delivery.id;
        const prev = out.get(k);
        out.set(k, { ...u.delivery, item_code: tree.lot.item_code, lot_number: tree.lot.lot_number, quantity: (prev?.quantity || 0) + u.quantity });
      }
      for (const p of u.produced || []) collect(p, kind, out);
    }
  } else {
    for (const r of tree.origin?.receipts || []) {
      out.set(`${tree.lot.id}-${r.receipt_id}`, { ...r, lot_number: tree.lot.lot_number, item_code: tree.lot.item_code, item_name: tree.lot.item_name });
    }
    for (const m of tree.materials || []) collect(m, kind, out);
  }
  return out;
}

async function trace(lotNumber) {
  const lot = await lotByNumber(lotNumber);
  if (!lot) return null;
  const back = await backward(lot);
  const fwd = await forward(lot);
  return {
    lot,
    backward: back,
    forward: fwd,
    customers: [...collect(fwd, 'customers').values()],
    suppliers: [...collect(back, 'suppliers').values()],
  };
}

module.exports = { trace, backward, forward, lotByNumber };
