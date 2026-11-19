/**
 * Sales documents: quote → order confirmation → delivery note → invoice,
 * credit notes (Rechnungskorrektur), payments.
 *
 * Rules (German law):
 *  - Numbers are assigned when a document is issued, from a gap-free series.
 *  - Issued documents are locked; the database refuses changes (see migration 002).
 *  - Invoices are corrected only by issuing a credit note that refers to them.
 *  - Invoices contain the data required by § 14 UStG; tax-free sales carry the
 *    legally required note.
 */
const crypto = require('node:crypto');
const db = require('../db');
const money = require('../lib/money');
const numbering = require('../lib/numbering');
const { lineTax, TAX_NOTES } = require('../lib/vat');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { addMinutes, todayLocal, nowLocal } = require('../lib/time');

const TITLES = {
  quote: 'Angebot',
  order: 'Auftragsbestätigung',
  delivery: 'Lieferschein',
  invoice: 'Rechnung',
  credit_note: 'Rechnungskorrektur',
};

// Which document can be created from which.
const CONVERSIONS = {
  quote: ['order'],
  order: ['delivery', 'invoice'],
  delivery: ['invoice'],
  invoice: ['credit_note'],
};

const HEADER_FIELDS = [
  'document_date', 'service_date', 'service_period_end', 'valid_until', 'delivery_date', 'payment_terms_days',
  'skonto_days', 'skonto_percent', 'customer_reference', 'buyer_reference', 'intro_text', 'closing_text', 'internal_notes',
];

// ─── Loading ────────────────────────────────────────────────────────────────

async function loadDocument(id, { forUpdate = false } = {}) {
  const doc = await db.get(`SELECT * FROM sales_documents WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  if (!doc) throw notFound('Document');
  doc.lines = await db.all('SELECT * FROM sales_document_lines WHERE document_id = ? ORDER BY position, id', [id]);
  doc.tax_breakdown = doc.tax_breakdown ? JSON.parse(doc.tax_breakdown) : [];
  doc.title = TITLES[doc.doc_type];
  doc.open_amount = ['invoice'].includes(doc.doc_type)
    ? money.sumAmounts([doc.gross_total, -doc.paid_total, -doc.credited_total])
    : doc.doc_type === 'credit_note' ? money.sumAmounts([doc.gross_total, -doc.paid_total]) : null;
  return doc;
}

async function getCompany() {
  return db.get('SELECT * FROM companies WHERE id = nova_company_id()');
}

function customerAddress(c) {
  const lines = [c.name, c.name2, c.street, [c.postal_code, c.city].filter(Boolean).join(' ')];
  if (c.country && c.country !== 'DE') lines.push(c.country);
  return lines.filter(Boolean).join('\n');
}

// ─── Drafts ─────────────────────────────────────────────────────────────────

/** Fills line defaults from the item, applies the tax treatment and calculates totals. */
async function prepareLines(lines, treatment) {
  const prepared = [];
  for (const [i, l] of lines.entries()) {
    let item = null;
    if (l.item_id) {
      item = await db.get('SELECT * FROM items WHERE id = ?', [l.item_id]);
      if (!item) throw badRequest(`Line ${i + 1}: item not found`);
    }
    const description = l.description || item?.name;
    if (!description) throw badRequest(`Line ${i + 1}: description is required`);
    const tax = lineTax(treatment, l.tax_rate ?? item?.tax_rate ?? 19);
    prepared.push({
      position: i + 1,
      item_id: item?.id ?? null,
      item_code: item?.item_code ?? null,
      description,
      quantity: l.quantity,
      unit: l.unit || item?.uom || 'Stk',
      unit_price: l.unit_price ?? item?.unit_price ?? 0,
      discount_percent: l.discount_percent ?? 0,
      tax_rate: tax.tax_rate,
      tax_category: tax.tax_category,
      source_line_id: l.source_line_id ?? null,
      calculation_id: l.calculation_id ?? null,
    });
  }
  const totals = money.computeTotals(prepared);
  prepared.forEach((l, i) => { l.line_net = totals.line_nets[i]; });
  return { lines: prepared, totals };
}

async function writeLines(documentId, lines) {
  await db.run('DELETE FROM sales_document_lines WHERE document_id = ?', [documentId]);
  for (const l of lines) {
    await db.run(`
      INSERT INTO sales_document_lines
        (document_id, position, item_id, item_code, description, quantity, unit, unit_price, discount_percent,
         tax_rate, tax_category, line_net, source_line_id, calculation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [documentId, l.position, l.item_id, l.item_code, l.description, l.quantity, l.unit, l.unit_price,
      l.discount_percent, l.tax_rate, l.tax_category, l.line_net, l.source_line_id, l.calculation_id ?? null]);
  }
}

/**
 * Creates (id = null) or updates a draft document.
 * input: { doc_type, customer_id, lines: [...], ...header fields, source_document_id?, cancels_document_id? }
 */
async function saveDraft(id, input, userId) {
  let existing = null;
  if (id) {
    existing = await db.get('SELECT * FROM sales_documents WHERE id = ? FOR UPDATE', [id]);
    if (!existing) throw notFound('Document');
    if (existing.locked) throw conflict('This document has been issued and can no longer be edited');
  }
  const docType = existing?.doc_type || input.doc_type;
  const customerId = input.customer_id ?? existing?.customer_id;
  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
  if (!customer) throw badRequest('Customer not found');

  const company = await getCompany();
  let treatment = company.small_business ? 'small_business' : customer.tax_treatment;
  // A credit note always uses the tax treatment of the invoice it corrects.
  const cancelsId = input.cancels_document_id ?? existing?.cancels_document_id;
  if (docType === 'credit_note') {
    const inv = cancelsId ? await db.get('SELECT tax_treatment, customer_id FROM sales_documents WHERE id = ?', [cancelsId]) : null;
    if (!inv) throw badRequest('A credit note must refer to an invoice');
    if (inv.customer_id !== customer.id) throw badRequest('A credit note must be for the customer of the invoice');
    treatment = inv.tax_treatment;
  }
  const lineInput = input.lines ?? (existing ? await db.all('SELECT * FROM sales_document_lines WHERE document_id = ? ORDER BY position', [id]) : []);

  // Lines may only link to lines of the document this one was created from.
  const linkedDocId = input.source_document_id ?? existing?.source_document_id ?? cancelsId;
  const linked = lineInput.filter((l) => l.source_line_id);
  if (linked.length) {
    const allowed = new Set(linkedDocId
      ? (await db.all('SELECT id FROM sales_document_lines WHERE document_id = ?', [linkedDocId])).map((r) => r.id)
      : []);
    if (linked.some((l) => !allowed.has(l.source_line_id))) throw badRequest('A line refers to a line of another document');
  }
  const { lines, totals } = await prepareLines(lineInput, treatment);

  const header = {};
  for (const f of HEADER_FIELDS) header[f] = input[f] !== undefined ? input[f] : (existing ? existing[f] : null);
  header.document_date = header.document_date || todayLocal(company.timezone);
  if (!existing) {
    header.payment_terms_days ??= customer.payment_terms_days ?? company.default_payment_terms_days;
    header.skonto_days ??= customer.skonto_days ?? company.default_skonto_days;
    header.skonto_percent ??= customer.skonto_percent ?? company.default_skonto_percent;
    header.buyer_reference ??= customer.leitweg_id;
  }
  if (docType === 'quote' && !header.valid_until) {
    header.valid_until = addMinutes(`${header.document_date} 00:00:00`, 30 * 24 * 60).slice(0, 10);
  }

  const values = {
    ...header,
    customer_id: customer.id,
    customer_name: customer.name,
    customer_address: customerAddress(customer),
    customer_country: customer.country,
    customer_vat_id: customer.vat_id,
    tax_treatment: treatment,
    net_total: totals.net_total,
    tax_total: totals.tax_total,
    gross_total: totals.gross_total,
    tax_breakdown: JSON.stringify(totals.breakdown),
  };
  const cols = Object.keys(values);

  let docId = id;
  if (existing) {
    await db.run(`UPDATE sales_documents SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = nova_now() WHERE id = ?`,
      [...cols.map((c) => values[c]), id]);
  } else {
    const extra = { doc_type: docType, created_by: userId, source_document_id: input.source_document_id ?? null, cancels_document_id: input.cancels_document_id ?? null };
    const all = { ...values, ...extra };
    const allCols = Object.keys(all);
    const row = await db.get(`INSERT INTO sales_documents (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')}) RETURNING id`,
      allCols.map((c) => all[c]));
    docId = row.id;
  }
  await writeLines(docId, lines);
  return loadDocument(docId);
}

async function deleteDraft(id) {
  const doc = await db.get('SELECT * FROM sales_documents WHERE id = ? FOR UPDATE', [id]);
  if (!doc) throw notFound('Document');
  if (doc.locked) throw conflict('Issued documents cannot be deleted. Cancel an invoice with a credit note instead.');
  await db.run('DELETE FROM sales_documents WHERE id = ?', [id]);
}

// ─── Conversion ─────────────────────────────────────────────────────────────

/** Creates a new draft from an issued document (e.g. order → delivery note). */
async function convert(sourceId, targetType, userId) {
  const src = await loadDocument(sourceId, { forUpdate: true });
  if (!CONVERSIONS[src.doc_type]?.includes(targetType)) {
    throw badRequest(`A ${TITLES[targetType]} cannot be created from a ${TITLES[src.doc_type]}`);
  }
  if (!src.locked) throw badRequest('Issue the document first');
  if (src.status === 'cancelled') throw badRequest('The document has been cancelled');

  let lines;
  if (targetType === 'delivery') {
    lines = src.lines.map((l) => ({ ...l, quantity: Math.max(0, l.quantity - l.delivered_quantity) }));
  } else if (targetType === 'invoice') {
    lines = src.lines.map((l) => ({ ...l, quantity: Math.max(0, l.quantity - l.invoiced_quantity) }));
  } else if (targetType === 'credit_note') {
    if (src.credited_total >= src.gross_total) throw badRequest('This invoice has already been fully cancelled');
    lines = src.lines;
  } else {
    lines = src.lines;
  }
  lines = lines.filter((l) => l.quantity > 0);
  if (!lines.length) throw badRequest(`Nothing left to put on a ${TITLES[targetType]}`);

  const input = {
    doc_type: targetType,
    customer_id: src.customer_id,
    customer_reference: src.customer_reference,
    buyer_reference: src.buyer_reference,
    payment_terms_days: src.payment_terms_days,
    skonto_days: src.skonto_days,
    skonto_percent: src.skonto_percent,
    service_date: targetType === 'invoice' && src.doc_type === 'delivery' ? src.document_date : src.service_date,
    delivery_date: src.delivery_date,
    source_document_id: targetType === 'credit_note' ? null : src.id,
    cancels_document_id: targetType === 'credit_note' ? src.id : null,
    intro_text: targetType === 'credit_note' ? `Korrektur zu Rechnung ${src.number} vom ${formatDateDE(src.document_date)}.` : null,
    lines: lines.map((l) => ({
      item_id: l.item_id, description: l.description, quantity: l.quantity, unit: l.unit,
      unit_price: l.unit_price, discount_percent: l.discount_percent, tax_rate: l.tax_rate, source_line_id: l.id, calculation_id: l.calculation_id,
    })),
  };
  const draft = await saveDraft(null, input, userId);
  if (src.doc_type === 'quote') await db.run("UPDATE sales_documents SET status = 'accepted' WHERE id = ?", [src.id]);
  return draft;
}

// ─── Issuing ────────────────────────────────────────────────────────────────

function formatDateDE(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** Problems that prevent issuing an invoice (§ 14 UStG and EN 16931). */
function invoiceProblems(doc, company) {
  const p = [];
  if (!company.legal_name && !company.name) p.push('Company name is missing (Settings)');
  if (!company.street || !company.postal_code || !company.city) p.push('Company address is incomplete (Settings)');
  if (!company.vat_id && !company.tax_number) p.push('Company VAT ID or tax number (Steuernummer) is missing (Settings)');
  if (!doc.customer_name || !doc.customer_address || doc.customer_address.split('\n').length < 3) p.push('Customer address is incomplete');
  if (!doc.lines.length) p.push('The document has no lines');
  if (doc.gross_total < 0) p.push('The total must not be negative');
  if (doc.tax_treatment === 'intra_eu') {
    if (!doc.customer_vat_id) p.push('Tax-free EU delivery requires the customer\'s VAT ID');
    if (!company.vat_id) p.push('Tax-free EU delivery requires your company\'s VAT ID (Settings)');
  }
  return p;
}

function contentHash(doc) {
  const canonical = {
    doc_type: doc.doc_type, number: doc.number, document_date: doc.document_date, service_date: doc.service_date,
    service_period_end: doc.service_period_end, due_date: doc.due_date, customer_name: doc.customer_name,
    customer_address: doc.customer_address, customer_vat_id: doc.customer_vat_id, tax_treatment: doc.tax_treatment,
    net_total: doc.net_total, tax_total: doc.tax_total, gross_total: doc.gross_total, currency: doc.currency,
    cancels_document_id: doc.cancels_document_id,
    lines: doc.lines.map((l) => [l.position, l.item_code, l.description, l.quantity, l.unit, l.unit_price, l.discount_percent, l.tax_category, l.tax_rate, l.line_net]),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Issues a draft: refreshes customer data and totals, assigns the number,
 * applies follow-up effects (stock, production, source quantities) and locks it.
 * opts.create_production: { planned_start } for order confirmations.
 * opts.archive: async (doc) => void — creates the archived PDF/e-invoice.
 */
async function issue(id, userId, opts = {}) {
  // Refresh customer snapshot and totals one last time.
  await saveDraft(id, {}, userId);
  const doc = await loadDocument(id, { forUpdate: true });
  const company = await getCompany();

  if (!doc.lines.length) throw badRequest('The document has no lines');

  if (['invoice', 'credit_note'].includes(doc.doc_type)) {
    const problems = invoiceProblems(doc, company);
    if (problems.length) throw badRequest(`Cannot issue: ${problems.join('; ')}`, problems.map((m) => ({ field: null, message: m })));
    doc.service_date = doc.service_date || doc.document_date;
  }

  if (doc.doc_type === 'credit_note') {
    const inv = await db.get('SELECT * FROM sales_documents WHERE id = ? FOR UPDATE', [doc.cancels_document_id]);
    if (!inv || inv.doc_type !== 'invoice' || !inv.locked) throw badRequest('A credit note must refer to an issued invoice');
    const remaining = money.sumAmounts([inv.gross_total, -inv.credited_total]);
    if (doc.gross_total > remaining) {
      throw badRequest(`The credit note (${money.formatEUR(doc.gross_total)}) exceeds the not yet credited amount of the invoice (${money.formatEUR(remaining)})`);
    }
    const credited = money.sumAmounts([inv.credited_total, doc.gross_total]);
    const status = credited >= inv.gross_total ? 'cancelled' : inv.status;
    await db.run('UPDATE sales_documents SET credited_total = ?, status = ?, updated_at = nova_now() WHERE id = ?', [credited, status, inv.id]);
    doc.intro_text = doc.intro_text || `Korrektur zu Rechnung ${inv.number} vom ${formatDateDE(inv.document_date)}.`;
  }

  const number = await numbering.nextNumber(doc.doc_type, doc.document_date);
  const dueDate = ['invoice'].includes(doc.doc_type)
    ? addMinutes(`${doc.document_date} 00:00:00`, (doc.payment_terms_days ?? company.default_payment_terms_days) * 24 * 60).slice(0, 10)
    : null;

  // Legally required notes for tax-free sales go into the closing text.
  const taxNote = TAX_NOTES[doc.tax_treatment];
  let closing = doc.closing_text || '';
  if (taxNote && ['invoice', 'credit_note'].includes(doc.doc_type) && !closing.includes(taxNote)) {
    closing = [taxNote, closing].filter(Boolean).join('\n');
  }

  // Effects on other records.
  const stockWarnings = doc.doc_type === 'delivery' ? await bookDelivery(doc, userId) : [];
  if (doc.doc_type === 'invoice') await markInvoiced(doc);
  if (doc.doc_type === 'order' && opts.create_production) await createProduction(doc, opts.create_production, userId);

  const final = { ...doc, number, due_date: dueDate, closing_text: closing };
  const hash = contentHash(final);
  const status = 'issued';
  await db.run(`
    UPDATE sales_documents SET number = ?, status = ?, due_date = ?, service_date = ?, closing_text = ?, intro_text = ?,
      issued_at = ?, issued_by = ?, content_hash = ?, locked = 1, updated_at = nova_now()
    WHERE id = ?`,
  [number, status, dueDate, final.service_date, closing || null, final.intro_text, nowLocal(company.timezone), userId, hash, id]);

  if (doc.source_document_id) await updateSourceStatus(doc.source_document_id);

  const issued = await loadDocument(id);
  if (opts.archive) await opts.archive(issued, company);
  return { ...issued, stock_warnings: stockWarnings };
}

/**
 * Delivery note: book finished goods out of stock and count delivered quantities on the order.
 * Returns the negative-stock warnings (company rule "warn").
 */
async function bookDelivery(doc, userId) {
  const stock = require('./stock');
  const warnings = [];
  for (const l of doc.lines) {
    if (l.item_id) {
      // Goods leave stock from their lots (first-in-first-out), so every
      // customer delivery can be traced back to production and materials.
      const r = await stock.consume({ itemId: l.item_id, qty: Number(l.quantity), referenceType: 'delivery', referenceId: doc.id, userId });
      if (r.warning) warnings.push(r.warning);
    }
    if (l.source_line_id) {
      await db.run('UPDATE sales_document_lines SET delivered_quantity = delivered_quantity + ? WHERE id = ?', [l.quantity, l.source_line_id]);
    }
  }
  return warnings;
}

/** Invoice: count invoiced quantities on the delivery note and/or order it came from. */
async function markInvoiced(doc) {
  for (const l of doc.lines) {
    if (!l.source_line_id) continue;
    const src = await db.get('SELECT id, source_line_id, document_id FROM sales_document_lines WHERE id = ?', [l.source_line_id]);
    if (!src) continue;
    await db.run('UPDATE sales_document_lines SET invoiced_quantity = invoiced_quantity + ? WHERE id = ?', [l.quantity, src.id]);
    const srcDoc = await db.get('SELECT doc_type FROM sales_documents WHERE id = ?', [src.document_id]);
    // Invoice from a delivery note: also count it on the original order line.
    if (srcDoc?.doc_type === 'delivery' && src.source_line_id) {
      await db.run('UPDATE sales_document_lines SET invoiced_quantity = invoiced_quantity + ? WHERE id = ?', [l.quantity, src.source_line_id]);
    }
  }
}

/** Order status from delivered quantities. */
async function updateSourceStatus(sourceId) {
  const src = await db.get('SELECT * FROM sales_documents WHERE id = ?', [sourceId]);
  if (!src) return;
  if (src.doc_type === 'delivery') {
    const order = await db.get('SELECT source_document_id FROM sales_documents WHERE id = ?', [sourceId]);
    if (order?.source_document_id) await updateSourceStatus(order.source_document_id);
    return;
  }
  if (src.doc_type !== 'order') return;
  const lines = await db.all('SELECT quantity, delivered_quantity, invoiced_quantity FROM sales_document_lines WHERE document_id = ?', [sourceId]);
  const delivered = lines.every((l) => l.delivered_quantity >= l.quantity);
  const anyDelivered = lines.some((l) => l.delivered_quantity > 0);
  const invoiced = lines.every((l) => l.invoiced_quantity >= l.quantity);
  let status = src.status;
  if (delivered && invoiced) status = 'closed';
  else if (delivered) status = 'delivered';
  else if (anyDelivered) status = 'partially_delivered';
  if (status !== src.status) await db.run('UPDATE sales_documents SET status = ? WHERE id = ?', [status, sourceId]);
}

/** Make-to-order: create production orders for manufactured items of an order confirmation. */
async function createProduction(doc, { planned_start: plannedStart }, userId) {
  const { createProductionOrders } = require('../routes/orders');
  for (const l of doc.lines) {
    if (!l.item_id) continue;
    const item = await db.get('SELECT * FROM items WHERE id = ?', [l.item_id]);
    if (!item || item.type === 'raw_material') continue;
    const route = await db.get('SELECT machine_id FROM item_routes WHERE item_id = ? ORDER BY sequence LIMIT 1', [item.id]);
    if (!route) continue; // no routing: cannot plan automatically
    const bom = await db.get('SELECT id FROM boms WHERE parent_item_id = ? ORDER BY id LIMIT 1', [item.id]);
    const created = await createProductionOrders([{
      item_id: item.id, bom_id: bom?.id ?? null, product_name: `${item.name} (${doc.customer_name})`,
      quantity: Math.ceil(l.quantity), planned_start: plannedStart, order_type: 'production', is_fixed_time: false,
      sales_line_id: l.id,
    }], userId);
    await db.run('UPDATE sales_document_lines SET production_order_id = ? WHERE id = ?', [created[0].id, l.id]);
  }
}

// ─── Payments ───────────────────────────────────────────────────────────────

async function refreshPaymentStatus(documentId) {
  const doc = await db.get('SELECT * FROM sales_documents WHERE id = ? FOR UPDATE', [documentId]);
  const sums = await db.get('SELECT COALESCE(SUM(amount + skonto_amount), 0) AS paid FROM payments WHERE document_id = ?', [documentId]);
  const paid = sums.paid;
  const open = money.sumAmounts([doc.gross_total, -paid, -doc.credited_total]);
  let status;
  if (doc.status === 'cancelled' && open <= 0) status = 'cancelled';
  else if (open <= 0) status = 'paid';
  else if (paid > 0) status = 'partially_paid';
  else status = 'issued';
  await db.run('UPDATE sales_documents SET paid_total = ?, status = ? WHERE id = ?', [paid, status, documentId]);
  return loadDocument(documentId);
}

async function recordPayment(documentId, p, userId) {
  const doc = await loadDocument(documentId, { forUpdate: true });
  if (doc.doc_type !== 'invoice' || !doc.locked) throw badRequest('Payments can only be recorded for issued invoices');
  if (p.amount > 0 && p.amount + (p.skonto_amount || 0) > doc.open_amount + 0.001) {
    throw badRequest(`The payment exceeds the open amount of ${money.formatEUR(doc.open_amount)}`);
  }
  // A reversal (negative amount) can only take back what was actually paid.
  if (p.amount < 0 && -(p.amount + (p.skonto_amount || 0)) > Number(doc.paid_total || 0) + 0.001) {
    throw badRequest(`The reversal exceeds the amount paid so far (${money.formatEUR(Number(doc.paid_total || 0))})`);
  }
  await db.run(`
    INSERT INTO payments (document_id, payment_date, amount, method, reference, skonto_amount, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [documentId, p.payment_date, p.amount, p.method, p.reference ?? null, p.skonto_amount ?? 0, p.notes ?? null, userId]);
  return refreshPaymentStatus(documentId);
}

module.exports = {
  TITLES, CONVERSIONS, loadDocument, saveDraft, deleteDraft, convert, issue, recordPayment, refreshPaymentStatus,
  invoiceProblems, contentHash, formatDateDE, getCompany, customerAddress,
};
