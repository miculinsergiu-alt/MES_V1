/**
 * Reading incoming e-invoices.
 *
 * Accepts:
 *  - ZUGFeRD / Factur-X PDF (the XML is extracted from the PDF attachments)
 *  - XRechnung or other EN 16931 XML, in both syntaxes: UN/CEFACT CII and OASIS UBL
 *
 * Returns one normalised structure, independent of the syntax, plus
 * plausibility warnings (totals that do not add up, missing mandatory data).
 */
const { XMLParser } = require('fast-xml-parser');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFHexString, PDFString, decodePDFRawStream } = require('pdf-lib');
const { badRequest } = require('../lib/errors');
const money = require('../lib/money');

const XML_NAMES = /^(factur-x|zugferd-invoice|ZUGFeRD-invoice|xrechnung)\.xml$/i;

// ─── PDF: extract embedded XML ──────────────────────────────────────────────

function pdfString(obj) {
  if (obj instanceof PDFHexString || obj instanceof PDFString) return obj.decodeText();
  return obj ? String(obj) : '';
}

/** All embedded files of a PDF as [{ name, data }]. */
async function pdfAttachments(buffer) {
  let doc;
  try {
    doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    throw badRequest(`The PDF could not be read: ${e.message}`);
  }
  const ctx = doc.context;
  const files = [];
  const seen = new Set();

  const addFilespec = (spec) => {
    const fs = ctx.lookup(spec);
    if (!(fs instanceof PDFDict)) return;
    const name = pdfString(fs.lookup(PDFName.of('UF')) || fs.lookup(PDFName.of('F')));
    const ef = fs.lookup(PDFName.of('EF'));
    if (!(ef instanceof PDFDict)) return;
    const stream = ef.lookup(PDFName.of('F')) || ef.lookup(PDFName.of('UF'));
    if (!(stream instanceof PDFRawStream) || seen.has(stream)) return;
    seen.add(stream);
    files.push({ name, data: Buffer.from(decodePDFRawStream(stream).decode()) });
  };

  // Name tree /Root /Names /EmbeddedFiles (with /Kids)
  const walk = (node) => {
    const n = ctx.lookup(node);
    if (!(n instanceof PDFDict)) return;
    const names = n.lookup(PDFName.of('Names'));
    if (names instanceof PDFArray) for (let i = 1; i < names.size(); i += 2) addFilespec(names.get(i));
    const kids = n.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i += 1) walk(kids.get(i));
  };
  const namesDict = doc.catalog.lookup(PDFName.of('Names'));
  if (namesDict instanceof PDFDict) walk(namesDict.get(PDFName.of('EmbeddedFiles')));
  // Associated files /Root /AF (PDF/A-3)
  const af = doc.catalog.lookup(PDFName.of('AF'));
  if (af instanceof PDFArray) for (let i = 0; i < af.size(); i += 1) addFilespec(af.get(i));
  return files;
}

async function xmlFromPdf(buffer) {
  const files = await pdfAttachments(buffer);
  const xml = files.find((f) => XML_NAMES.test(f.name)) || files.find((f) => /\.xml$/i.test(f.name));
  if (!xml) throw badRequest('This PDF contains no e-invoice data (no ZUGFeRD / Factur-X XML attached). A plain PDF is not an e-invoice.');
  return xml.data.toString('utf8');
}

// ─── XML parsing helpers ────────────────────────────────────────────────────

const ARRAYS = new Set([
  'IncludedSupplyChainTradeLineItem', 'ApplicableTradeTax', 'SpecifiedTaxRegistration', 'IncludedNote',
  'SpecifiedTradeSettlementPaymentMeans', 'SpecifiedTradePaymentTerms', 'TaxTotalAmount',
  'InvoiceLine', 'CreditNoteLine', 'TaxTotal', 'TaxSubtotal', 'PartyTaxScheme', 'PaymentMeans', 'PaymentTerms', 'Note',
]);

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (name) => ARRAYS.has(name),
});

/** Text of a node ({ '#text': ... } or plain string). */
const txt = (n) => {
  if (n === undefined || n === null) return null;
  if (typeof n === 'object') return n['#text'] !== undefined ? String(n['#text']) : null;
  return String(n);
};
const get = (obj, path) => path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
const arr = (x) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
const numOrNull = (x) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
/** CII date format 102 = YYYYMMDD. */
const ciiDate = (n) => {
  const s = txt(get(n, 'DateTimeString') ?? n);
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.slice(0, 10);
};

function ciiParty(p) {
  if (!p) return {};
  const regs = arr(p.SpecifiedTaxRegistration).map((r) => ({ scheme: r.ID?.['@schemeID'], id: txt(r.ID) }));
  const a = p.PostalTradeAddress || {};
  return {
    name: txt(p.Name),
    vat_id: regs.find((r) => r.scheme === 'VA')?.id || null,
    tax_number: regs.find((r) => r.scheme === 'FC')?.id || null,
    street: txt(a.LineOne),
    postal_code: txt(a.PostcodeCode),
    city: txt(a.CityName),
    country: txt(a.CountryID),
    email: txt(get(p, 'URIUniversalCommunication.URIID')),
  };
}

function parseCii(root) {
  const doc = root.ExchangedDocument || {};
  const tx = root.SupplyChainTradeTransaction || {};
  const agreement = tx.ApplicableHeaderTradeAgreement || {};
  const settlement = tx.ApplicableHeaderTradeSettlement || {};
  const sums = settlement.SpecifiedTradeSettlementHeaderMonetarySummation || {};
  const currency = txt(settlement.InvoiceCurrencyCode) || 'EUR';
  const taxTotal = arr(sums.TaxTotalAmount).find((t) => !t['@currencyID'] || t['@currencyID'] === currency) || arr(sums.TaxTotalAmount)[0];
  const terms = arr(settlement.SpecifiedTradePaymentTerms);

  return {
    syntax: 'CII',
    profile: txt(get(root, 'ExchangedDocumentContext.GuidelineSpecifiedDocumentContextParameter.ID')),
    number: txt(doc.ID),
    type_code: txt(doc.TypeCode),
    issue_date: ciiDate(doc.IssueDateTime),
    due_date: terms.map((t) => (t.DueDateDateTime ? ciiDate(t.DueDateDateTime) : null)).find(Boolean) || null,
    delivery_date: tx.ApplicableHeaderTradeDelivery?.ActualDeliverySupplyChainEvent ? ciiDate(get(tx, 'ApplicableHeaderTradeDelivery.ActualDeliverySupplyChainEvent.OccurrenceDateTime')) : null,
    currency,
    notes: arr(doc.IncludedNote).map((n) => txt(n.Content)).filter(Boolean),
    buyer_reference: txt(agreement.BuyerReference),
    order_reference: txt(get(agreement, 'BuyerOrderReferencedDocument.IssuerAssignedID')),
    preceding_invoice: txt(get(settlement, 'InvoiceReferencedDocument.IssuerAssignedID')),
    seller: ciiParty(agreement.SellerTradeParty),
    buyer: ciiParty(agreement.BuyerTradeParty),
    iban: arr(settlement.SpecifiedTradeSettlementPaymentMeans).map((m) => txt(get(m, 'PayeePartyCreditorFinancialAccount.IBANID'))).find(Boolean) || null,
    payment_terms: terms.map((t) => txt(t.Description)).filter(Boolean).join('\n') || null,
    taxes: arr(settlement.ApplicableTradeTax).map((t) => ({
      category: txt(t.CategoryCode), rate: numOrNull(txt(t.RateApplicablePercent)),
      base: numOrNull(txt(t.BasisAmount)), amount: numOrNull(txt(t.CalculatedAmount)),
      exemption: txt(t.ExemptionReason),
    })),
    totals: {
      lines: numOrNull(txt(sums.LineTotalAmount)),
      net: numOrNull(txt(sums.TaxBasisTotalAmount)),
      tax: numOrNull(txt(taxTotal)),
      gross: numOrNull(txt(sums.GrandTotalAmount)),
      prepaid: numOrNull(txt(sums.TotalPrepaidAmount)),
      due: numOrNull(txt(sums.DuePayableAmount)),
    },
    lines: arr(tx.IncludedSupplyChainTradeLineItem).map((l) => {
      const qty = get(l, 'SpecifiedLineTradeDelivery.BilledQuantity');
      const tax = arr(get(l, 'SpecifiedLineTradeSettlement.ApplicableTradeTax'))[0] || {};
      return {
        position: txt(get(l, 'AssociatedDocumentLineDocument.LineID')),
        item_code: txt(get(l, 'SpecifiedTradeProduct.SellerAssignedID')),
        name: txt(get(l, 'SpecifiedTradeProduct.Name')),
        description: txt(get(l, 'SpecifiedTradeProduct.Description')),
        quantity: numOrNull(txt(qty)),
        unit: qty?.['@unitCode'] || null,
        unit_price: numOrNull(txt(get(l, 'SpecifiedLineTradeAgreement.NetPriceProductTradePrice.ChargeAmount'))),
        net: numOrNull(txt(get(l, 'SpecifiedLineTradeSettlement.SpecifiedTradeSettlementLineMonetarySummation.LineTotalAmount'))),
        tax_category: txt(tax.CategoryCode),
        tax_rate: numOrNull(txt(tax.RateApplicablePercent)),
      };
    }),
  };
}

function ublParty(p) {
  if (!p) return {};
  const schemes = arr(p.PartyTaxScheme).map((s) => ({ scheme: txt(get(s, 'TaxScheme.ID')), id: txt(s.CompanyID) }));
  const a = p.PostalAddress || {};
  return {
    name: txt(get(p, 'PartyLegalEntity.RegistrationName')) || txt(get(p, 'PartyName.Name')),
    vat_id: schemes.find((s) => s.scheme === 'VAT')?.id || null,
    tax_number: schemes.find((s) => s.scheme && s.scheme !== 'VAT')?.id || null,
    street: txt(a.StreetName),
    postal_code: txt(a.PostalZone),
    city: txt(a.CityName),
    country: txt(get(a, 'Country.IdentificationCode')),
    email: txt(p.EndpointID),
  };
}

function parseUbl(root, isCreditNote) {
  const m = root.LegalMonetaryTotal || {};
  const taxTotal = arr(root.TaxTotal).find((t) => t.TaxSubtotal) || arr(root.TaxTotal)[0] || {};
  const lineKey = isCreditNote ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyKey = isCreditNote ? 'CreditedQuantity' : 'InvoicedQuantity';
  return {
    syntax: 'UBL',
    profile: txt(root.CustomizationID),
    number: txt(root.ID),
    type_code: txt(isCreditNote ? root.CreditNoteTypeCode : root.InvoiceTypeCode) || (isCreditNote ? '381' : '380'),
    issue_date: txt(root.IssueDate),
    due_date: txt(root.DueDate),
    delivery_date: txt(get(root, 'Delivery.ActualDeliveryDate')),
    currency: txt(root.DocumentCurrencyCode) || 'EUR',
    notes: arr(root.Note).map(txt).filter(Boolean),
    buyer_reference: txt(root.BuyerReference),
    order_reference: txt(get(root, 'OrderReference.ID')),
    preceding_invoice: txt(get(root, 'BillingReference.InvoiceDocumentReference.ID')),
    seller: ublParty(get(root, 'AccountingSupplierParty.Party')),
    buyer: ublParty(get(root, 'AccountingCustomerParty.Party')),
    iban: arr(root.PaymentMeans).map((p) => txt(get(p, 'PayeeFinancialAccount.ID'))).find(Boolean) || null,
    payment_terms: arr(root.PaymentTerms).map((p) => txt(p.Note)).filter(Boolean).join('\n') || null,
    taxes: arr(taxTotal.TaxSubtotal).map((s) => ({
      category: txt(get(s, 'TaxCategory.ID')), rate: numOrNull(txt(get(s, 'TaxCategory.Percent'))),
      base: numOrNull(txt(s.TaxableAmount)), amount: numOrNull(txt(s.TaxAmount)),
      exemption: txt(get(s, 'TaxCategory.TaxExemptionReason')),
    })),
    totals: {
      lines: numOrNull(txt(m.LineExtensionAmount)),
      net: numOrNull(txt(m.TaxExclusiveAmount)),
      tax: numOrNull(txt(taxTotal.TaxAmount)),
      gross: numOrNull(txt(m.TaxInclusiveAmount)),
      prepaid: numOrNull(txt(m.PrepaidAmount)),
      due: numOrNull(txt(m.PayableAmount)),
    },
    lines: arr(root[lineKey]).map((l) => ({
      position: txt(l.ID),
      item_code: txt(get(l, 'Item.SellersItemIdentification.ID')),
      name: txt(get(l, 'Item.Name')),
      description: txt(get(l, 'Item.Description')),
      quantity: numOrNull(txt(l[qtyKey])),
      unit: l[qtyKey]?.['@unitCode'] || null,
      unit_price: numOrNull(txt(get(l, 'Price.PriceAmount'))),
      net: numOrNull(txt(l.LineExtensionAmount)),
      tax_category: txt(get(l, 'Item.ClassifiedTaxCategory.ID')),
      tax_rate: numOrNull(txt(get(l, 'Item.ClassifiedTaxCategory.Percent'))),
    })),
  };
}

// ─── Plausibility checks ────────────────────────────────────────────────────

function plausibility(inv) {
  const w = [];
  const eq = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.005;
  if (!inv.number) w.push('Invoice number (BT-1) is missing');
  if (!inv.issue_date) w.push('Invoice date (BT-2) is missing');
  if (!inv.seller.name) w.push('Seller name is missing');
  if (!inv.seller.vat_id && !inv.seller.tax_number) w.push('Seller has neither VAT ID nor tax number (required by § 14 UStG)');
  if (!inv.lines.length) w.push('The invoice has no lines');
  const t = inv.totals;
  if (inv.lines.length && t.lines !== null) {
    const sum = money.sumAmounts(inv.lines.map((l) => l.net || 0));
    if (!eq(sum, t.lines)) w.push(`Sum of the lines (${sum.toFixed(2)}) does not match the line total (${t.lines.toFixed(2)})`);
  }
  if (t.net !== null && t.tax !== null && t.gross !== null && !eq(money.sumAmounts([t.net, t.tax]), t.gross)) {
    w.push(`Net (${t.net.toFixed(2)}) + VAT (${t.tax.toFixed(2)}) does not equal the gross total (${t.gross.toFixed(2)})`);
  }
  for (const x of inv.taxes) {
    if (x.base !== null && x.rate !== null && x.amount !== null) {
      const expected = money.fromCents(money.taxCents(money.toCents(x.base), x.rate));
      if (!eq(expected, x.amount)) w.push(`VAT ${x.rate} % on ${x.base.toFixed(2)} should be ${expected.toFixed(2)}, invoice says ${x.amount.toFixed(2)}`);
    }
  }
  if (inv.taxes.length && t.tax !== null) {
    const sum = money.sumAmounts(inv.taxes.map((x) => x.amount || 0));
    if (!eq(sum, t.tax)) w.push(`Sum of the VAT breakdown (${sum.toFixed(2)}) does not match the VAT total (${t.tax.toFixed(2)})`);
  }
  return w;
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Reads an incoming e-invoice file.
 * Returns { format, invoice, warnings, xml }.
 */
async function readEInvoice(buffer, filename = '') {
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  let xml;
  if (isPdf) xml = await xmlFromPdf(buffer);
  else {
    xml = buffer.toString('utf8').replace(/^﻿/, '');
    if (!/^\s*</.test(xml)) throw badRequest(`${filename || 'The file'} is neither a PDF nor an XML file`);
  }

  let doc;
  try {
    doc = parser.parse(xml);
  } catch (e) {
    throw badRequest(`The XML could not be read: ${e.message}`);
  }
  let invoice;
  if (doc.CrossIndustryInvoice) invoice = parseCii(doc.CrossIndustryInvoice);
  else if (doc.Invoice) invoice = parseUbl(doc.Invoice, false);
  else if (doc.CreditNote) invoice = parseUbl(doc.CreditNote, true);
  else throw badRequest('This XML is not an e-invoice (expected CII CrossIndustryInvoice or UBL Invoice/CreditNote)');

  const isXRechnung = /xrechnung/i.test(invoice.profile || '');
  const format = isPdf
    ? `ZUGFeRD/Factur-X (${invoice.syntax})`
    : `${isXRechnung ? 'XRechnung' : 'EN 16931 XML'} (${invoice.syntax})`;
  return { format, invoice, warnings: plausibility(invoice), xml };
}

module.exports = { readEInvoice, pdfAttachments, plausibility };
