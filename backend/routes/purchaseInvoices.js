const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest, AppError } = require('../lib/errors');
const { normalizeVatId } = require('../lib/vat');
const { readEInvoice } = require('../services/einvoice-in');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const READERS = ['administrator', 'accounting', 'material_planner', 'planner', 'warehouse_manager'];
const DECIDERS = ['administrator', 'accounting'];
const MAX_BYTES = 15 * 1024 * 1024;

const LIST_FIELDS = `id, supplier_id, po_id, status, format, type_code, invoice_number, invoice_date, due_date, currency,
  seller_name, seller_vat_id, net_total, tax_total, gross_total, due_amount, warnings, original_filename, received_at`;

function shape(row) {
  if (!row) return row;
  const { original_content, parsed, warnings, ...rest } = row;
  return {
    ...rest,
    warnings: warnings ? JSON.parse(warnings) : [],
    ...(parsed ? { invoice: JSON.parse(parsed) } : {}),
  };
}

/** Supplier by VAT ID, otherwise by exact name. */
async function matchSupplier(seller) {
  const vat = normalizeVatId(seller.vat_id);
  if (vat) {
    const s = await db.get('SELECT id FROM suppliers WHERE vat_number = ? ORDER BY id LIMIT 1', [vat]);
    if (s) return s.id;
  }
  if (seller.name) {
    const s = await db.get('SELECT id FROM suppliers WHERE lower(name) = lower(?) ORDER BY id LIMIT 1', [seller.name.trim()]);
    if (s) return s.id;
  }
  return null;
}

/** Purchase order from the order reference ("123", "PO-123", "Bestellung 123"), only if it belongs to the supplier. */
async function matchPurchaseOrder(orderRef, supplierId) {
  const m = String(orderRef || '').match(/(\d+)\s*$/);
  if (!m || !supplierId) return null;
  const po = await db.get('SELECT id FROM purchase_orders WHERE id = ? AND supplier_id = ?', [Number(m[1]), supplierId]);
  return po?.id ?? null;
}

// GET /api/purchase-invoices?status=received
router.get('/', requireRole(...READERS), h(async (req, res) => {
  const q = v.query(req, v.z.object({ status: v.z.enum(['received', 'approved', 'rejected', 'paid']).optional() }));
  const rows = await db.all(
    `SELECT ${LIST_FIELDS} FROM purchase_invoices ${q.status ? 'WHERE status = ?' : ''} ORDER BY received_at DESC, id DESC LIMIT 1000`,
    q.status ? [q.status] : [],
  );
  res.json(rows.map(shape));
}));

// POST /api/purchase-invoices — upload an e-invoice (JSON: { filename, content_base64 })
router.post('/', requireRole(...READERS), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    filename: v.z.string().trim().min(1).max(255),
    content_base64: v.z.string().min(1),
  }));
  const buffer = Buffer.from(b.content_base64, 'base64');
  if (!buffer.length) throw badRequest('The file is empty');
  if (buffer.length > MAX_BYTES) throw badRequest('The file is larger than 15 MB');

  const { format, invoice, warnings } = await readEInvoice(buffer, b.filename);
  if (!invoice.number) throw badRequest('The invoice has no invoice number');

  // Duplicate: same number from the same seller
  const sellerVat = normalizeVatId(invoice.seller.vat_id);
  const dup = await db.get(`
    SELECT id FROM purchase_invoices
    WHERE invoice_number = ? AND (seller_vat_id = ? OR lower(seller_name) = lower(?))`,
  [invoice.number, sellerVat || invoice.seller.vat_id || '', invoice.seller.name || '']);
  if (dup) throw new AppError(409, 'DUPLICATE_INVOICE', `Invoice ${invoice.number} from ${invoice.seller.name} was already received`, { existing_id: dup.id });

  const supplierId = await matchSupplier(invoice.seller);
  const poId = await matchPurchaseOrder(invoice.order_reference, supplierId);
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-';

  const row = await db.get(`
    INSERT INTO purchase_invoices
      (supplier_id, po_id, format, profile, type_code, invoice_number, invoice_date, due_date, delivery_date, currency,
       seller_name, seller_vat_id, seller_tax_number, seller_iban, buyer_reference, order_reference,
       net_total, tax_total, gross_total, due_amount, parsed, warnings,
       original_filename, original_mime, original_content, original_sha256, received_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING ${LIST_FIELDS}, parsed`,
  [supplierId, poId, format, invoice.profile, invoice.type_code, invoice.number, invoice.issue_date, invoice.due_date,
    invoice.delivery_date, invoice.currency, invoice.seller.name, sellerVat || invoice.seller.vat_id, invoice.seller.tax_number,
    invoice.iban, invoice.buyer_reference, invoice.order_reference, invoice.totals.net, invoice.totals.tax, invoice.totals.gross,
    invoice.totals.due ?? invoice.totals.gross, JSON.stringify(invoice), JSON.stringify(warnings),
    b.filename, isPdf ? 'application/pdf' : 'application/xml', buffer, crypto.createHash('sha256').update(buffer).digest('hex'),
    req.user.id]);
  res.status(201).json(shape(row));
}));

// GET /api/purchase-invoices/:id — extracted data, readable
router.get('/:id', requireRole(...READERS), h(async (req, res) => {
  const row = await db.get(`
    SELECT pi.*, s.name AS supplier_name, u.first_name || ' ' || u.last_name AS received_by_name
    FROM purchase_invoices pi
    LEFT JOIN suppliers s ON s.id = pi.supplier_id
    LEFT JOIN users u ON u.id = pi.received_by
    WHERE pi.id = ?`, [v.paramId(req)]);
  if (!row) throw notFound('Invoice');
  let po = null;
  if (row.po_id) {
    po = await db.get('SELECT id, po_number, status, order_date, expected_date FROM purchase_orders WHERE id = ?', [row.po_id]);
    po.items = await db.all(`
      SELECT poi.quantity_ordered, poi.quantity_received, poi.unit_price, i.item_code, i.name
      FROM purchase_order_items poi JOIN items i ON i.id = poi.item_id WHERE poi.po_id = ?`, [row.po_id]);
    po.net_total = Math.round(po.items.reduce((s, i) => s + i.quantity_ordered * (i.unit_price || 0), 0) * 100) / 100;
  }
  res.json({ ...shape(row), purchase_order: po });
}));

// GET /api/purchase-invoices/:id/original — the archived original file
router.get('/:id/original', requireRole(...READERS), h(async (req, res) => {
  const row = await db.get('SELECT original_filename, original_mime, original_content FROM purchase_invoices WHERE id = ?', [v.paramId(req)]);
  if (!row) throw notFound('Invoice');
  res.setHeader('Content-Type', row.original_mime);
  res.setHeader('Content-Disposition', `attachment; filename="${row.original_filename.replace(/[^\w.\-]+/g, '_')}"`);
  res.end(row.original_content);
}));

// PUT /api/purchase-invoices/:id — assign supplier / purchase order, notes
router.put('/:id', requireRole(...READERS), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object({ supplier_id: v.optId, po_id: v.optId, notes: v.optStr(5000) }));
  const row = await db.get('SELECT * FROM purchase_invoices WHERE id = ? FOR UPDATE', [id]);
  if (!row) throw notFound('Invoice');
  const supplierId = b.supplier_id !== undefined ? b.supplier_id : row.supplier_id;
  const poId = b.po_id !== undefined ? b.po_id : row.po_id;
  if (poId) {
    const po = await db.get('SELECT supplier_id FROM purchase_orders WHERE id = ?', [poId]);
    if (!po) throw badRequest('Purchase order not found');
    if (supplierId && po.supplier_id !== supplierId) throw badRequest('The purchase order belongs to a different supplier');
  }
  await db.run('UPDATE purchase_invoices SET supplier_id = ?, po_id = ?, notes = ? WHERE id = ?',
    [supplierId ?? null, poId ?? null, b.notes !== undefined ? b.notes : row.notes, id]);
  res.json({ message: 'Saved' });
}));

// POST /api/purchase-invoices/:id/create-supplier — create the supplier from the invoice data
router.post('/:id/create-supplier', requireRole(...READERS), h(async (req, res) => {
  const id = v.paramId(req);
  const row = await db.get('SELECT * FROM purchase_invoices WHERE id = ? FOR UPDATE', [id]);
  if (!row) throw notFound('Invoice');
  if (row.supplier_id) throw badRequest('A supplier is already assigned');
  const seller = JSON.parse(row.parsed).seller;
  const address = [seller.street, [seller.postal_code, seller.city].filter(Boolean).join(' '), seller.country && seller.country !== 'DE' ? seller.country : null]
    .filter(Boolean).join(', ');
  const s = await db.get('INSERT INTO suppliers (name, email, address, vat_number) VALUES (?, ?, ?, ?) RETURNING id',
    [seller.name || row.seller_name, seller.email || null, address || null, normalizeVatId(seller.vat_id)]);
  await db.run('UPDATE purchase_invoices SET supplier_id = ? WHERE id = ?', [s.id, id]);
  res.status(201).json({ supplier_id: s.id });
}));

// POST /api/purchase-invoices/:id/status — approve / reject / mark paid
router.post('/:id/status', requireRole(...DECIDERS), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object({ status: v.z.enum(['approved', 'rejected', 'paid', 'received']), notes: v.optStr(5000) }));
  const row = await db.get('SELECT status, notes FROM purchase_invoices WHERE id = ? FOR UPDATE', [id]);
  if (!row) throw notFound('Invoice');
  const allowed = { received: ['approved', 'rejected'], approved: ['paid', 'received'], rejected: ['received'], paid: [] };
  if (!allowed[row.status].includes(b.status)) throw badRequest(`Status cannot change from ${row.status} to ${b.status}`);
  await db.run('UPDATE purchase_invoices SET status = ?, notes = ?, decided_by = ?, decided_at = nova_now() WHERE id = ?',
    [b.status, b.notes !== undefined ? b.notes : row.notes, req.user.id, id]);
  res.json({ status: b.status });
}));

module.exports = router;
