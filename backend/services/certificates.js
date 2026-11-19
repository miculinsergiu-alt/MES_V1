/**
 * Material certificates (EN 10204 2.1/2.2/3.1/3.2) along the batch trace.
 *
 * A delivery note ships finished lots. Their backward trace leads to the
 * purchased material lots; the certificates on those lots (and on the shipped
 * lots themselves, e.g. for traded goods) form the certificate pack
 * ("Zeugnismappe") the customer receives with the delivery.
 */
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const db = require('../db');
const { backward } = require('./trace');

const lotRow = (id) => db.get(`
  SELECT il.id, il.lot_number, il.item_id, il.quantity, il.source_type, il.production_order_id, il.created_at,
         i.item_code, i.name AS item_name, i.uom, i.requires_certificate
  FROM inventory_lots il JOIN items i ON i.id = il.item_id WHERE il.id = ?`, [id]);

/** All lots in the backward tree that were bought (not produced), with their path quantity. */
function purchasedLots(node, out = new Map()) {
  if (!node.lot.production_order_id) out.set(node.lot.id, node.lot);
  for (const m of node.materials || []) purchasedLots(m, out);
  return out;
}

async function certificatesOfLots(lotIds) {
  if (!lotIds.length) return [];
  return db.all(
    `SELECT id, owner_id AS lot_id, filename, mime_type, size_bytes, cert_type, heat_number, created_at
     FROM attachments WHERE owner_type = 'lot' AND kind = 'certificate' AND owner_id = ANY(?::int[])
     ORDER BY owner_id, created_at`, [lotIds],
  );
}

/** Shipped lots of a delivery note with the certificates of their materials. */
async function forDelivery(documentId) {
  const doc = await db.get(`SELECT id, number, doc_type, document_date, customer_id, customer_name, status FROM sales_documents WHERE id = ?`, [documentId]);
  if (!doc) return null;
  const shipped = await db.all(`
    SELECT lot_id, -SUM(quantity) AS quantity FROM stock_transactions
    WHERE reference_type = 'delivery' AND reference_id = ? AND type = 'out' AND lot_id IS NOT NULL
    GROUP BY lot_id ORDER BY MIN(id)`, [documentId]);
  const customer = doc.customer_id
    ? await db.get('SELECT requires_certificates FROM customers WHERE id = ?', [doc.customer_id]) : null;

  const lines = [];
  for (const s of shipped) {
    const lot = await lotRow(s.lot_id);
    if (!lot) continue;
    const tree = await backward(lot);
    const materials = [...purchasedLots(tree).values()];
    const ids = [...new Set([lot.id, ...materials.map((m) => m.id)])];
    const certs = await certificatesOfLots(ids);
    const flagged = await db.all('SELECT il.id FROM inventory_lots il JOIN items i ON i.id = il.item_id WHERE il.id = ANY(?::int[]) AND i.requires_certificate = 1', [materials.map((m) => m.id)]);
    const missing = flagged.map((f) => f.id).filter((id) => !certs.some((c) => c.lot_id === id));
    lines.push({
      lot: { id: lot.id, lot_number: lot.lot_number, item_code: lot.item_code, item_name: lot.item_name, uom: lot.uom },
      quantity: s.quantity,
      materials: materials.filter((m) => m.id !== lot.id).map((m) => ({ id: m.id, lot_number: m.lot_number, item_code: m.item_code, item_name: m.item_name })),
      certificates: certs,
      missing_lot_ids: missing,
    });
  }
  const missingCount = lines.reduce((n, l) => n + l.missing_lot_ids.length, 0);
  return { document: doc, customer_requires_certificates: !!customer?.requires_certificates, lines, missing_count: missingCount };
}

/** One PDF: cover sheet listing parts, lots, heat numbers + every certificate appended. */
async function packPdf(pack, company) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // WinAnsi fonts: keep German umlauts, drop characters the standard fonts cannot draw.
  const safe = (s) => String(s ?? '').replace(/[^\x20-\x7E -ÿ€]/g, '?');

  let page = pdf.addPage([595, 842]);
  let y = 790;
  const line = (text, opts = {}) => {
    if (y < 60) { page = pdf.addPage([595, 842]); y = 790; }
    page.drawText(safe(text), { x: opts.x || 50, y, size: opts.size || 10, font: opts.bold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
    y -= opts.gap || 15;
  };
  line('Werkszeugnisse / Material certificates (EN 10204)', { size: 16, bold: true, gap: 24 });
  line(`${company?.name || ''}`, { gap: 14 });
  line(`Lieferschein / Delivery note: ${pack.document.number || pack.document.id}   Datum: ${pack.document.document_date || ''}`);
  line(`Kunde / Customer: ${pack.document.customer_name || ''}`, { gap: 24 });

  const attachmentIds = [];
  for (const l of pack.lines) {
    line(`${l.lot.item_code} · ${l.lot.item_name}  -  Charge ${l.lot.lot_number}  -  ${l.quantity} ${l.lot.uom || ''}`, { bold: true });
    if (l.materials.length) line(`Material: ${l.materials.map((m) => `${m.item_code} (${m.lot_number})`).join(', ')}`, { x: 64 });
    for (const c of l.certificates) {
      attachmentIds.push(c.id);
      line(`Zeugnis ${c.cert_type || ''}  Schmelze/Heat ${c.heat_number || '-'}  ${c.filename}`, { x: 64 });
    }
    if (l.missing_lot_ids.length) line(`FEHLT / MISSING: certificate for ${l.missing_lot_ids.length} material lot(s)`, { x: 64, bold: true });
    y -= 6;
  }

  for (const id of [...new Set(attachmentIds)]) {
    const f = await db.get('SELECT filename, mime_type, content FROM attachments WHERE id = ?', [id]);
    const bytes = Buffer.from(f.content);
    try {
      if (f.mime_type === 'application/pdf') {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        for (const p of await pdf.copyPages(src, src.getPageIndices())) pdf.addPage(p);
      } else if (f.mime_type === 'image/png' || f.mime_type === 'image/jpeg') {
        const img = f.mime_type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const p = pdf.addPage([595, 842]);
        const scale = Math.min(515 / img.width, 762 / img.height, 1);
        p.drawImage(img, { x: 40, y: 802 - img.height * scale, width: img.width * scale, height: img.height * scale });
      }
    } catch {
      const p = pdf.addPage([595, 842]);
      p.drawText(safe(`${f.filename}: could not be embedded, please open it separately.`), { x: 50, y: 790, size: 11, font });
    }
  }
  return Buffer.from(await pdf.save());
}

module.exports = { forDelivery, packPdf };
