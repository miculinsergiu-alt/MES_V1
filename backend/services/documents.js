/**
 * Document files: rendering and GoBD archive.
 *
 * When a document is issued, its files are generated once and stored
 * unchangeably in document_files (the database refuses updates/deletes):
 *  - invoices / credit notes: ZUGFeRD PDF (PDF/A-3 with EN 16931 XML) + XRechnung XML
 *  - other documents: PDF
 * Later downloads always return the archived files, never a re-rendered copy.
 */
const crypto = require('node:crypto');
const db = require('../db');
const pdf = require('./pdf');
const einvoice = require('./einvoice');
const sales = require('./sales');
const { notFound } = require('../lib/errors');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const UMLAUTS = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };
const safeName = (s) => String(s).replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c]).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9._-]+/g, '_');

async function storeFile(documentId, kind, filename, mimeType, buffer, { dunningId = null } = {}) {
  await db.run(`
    INSERT INTO document_files (document_id, dunning_id, kind, filename, mime_type, content, sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [documentId, dunningId, kind, filename, mimeType, buffer, sha256(buffer)]);
}

/** Called inside the issuing transaction: if rendering fails, issuing fails too. */
async function archiveDocument(doc, company) {
  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [doc.customer_id]);
  const visual = await pdf.renderSalesDocument(doc, company, customer);
  const base = safeName(`${doc.title || pdf.TITLES[doc.doc_type]}_${doc.number}`);

  if (['invoice', 'credit_note'].includes(doc.doc_type)) {
    const original = doc.cancels_document_id
      ? await db.get('SELECT number, document_date FROM sales_documents WHERE id = ?', [doc.cancels_document_id]) : null;
    const data = einvoice.buildInvoiceData(doc, company, customer, { originalInvoice: original });
    const zugferd = await einvoice.render('zugferd', data, { pdf: visual, filename: `${base}.pdf` });
    await storeFile(doc.id, 'zugferd', `${base}.pdf`, 'application/pdf', zugferd);
    // XRechnung only when the stricter German rules can be met (e-mail addresses etc.).
    if (!einvoice.xrechnungProblems(company, customer).length) {
      const xml = await einvoice.render('xrechnung', data);
      await storeFile(doc.id, 'xrechnung', `${base}_XRechnung.xml`, 'application/xml', xml);
    }
  } else {
    await storeFile(doc.id, 'pdf', `${base}.pdf`, 'application/pdf', visual);
  }
}

/** PDF of a document: archived file if issued, otherwise a live draft preview. */
async function pdfFor(id) {
  const doc = await sales.loadDocument(id);
  if (doc.locked) {
    const f = await db.get("SELECT filename, content FROM document_files WHERE document_id = ? AND kind IN ('zugferd','pdf') ORDER BY id LIMIT 1", [id]);
    if (!f) throw notFound('Archived PDF');
    return { buffer: f.content, filename: f.filename };
  }
  const company = await sales.getCompany();
  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [doc.customer_id]);
  const buffer = await pdf.renderSalesDocument(doc, company, customer);
  return { buffer, filename: safeName(`${doc.title || pdf.TITLES[doc.doc_type]}_${doc.language === 'en' ? 'Draft' : 'Entwurf'}_${doc.id}.pdf`) };
}

module.exports = { archiveDocument, pdfFor, storeFile, sha256 };
