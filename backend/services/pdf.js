/**
 * PDF layout for sales documents and payment reminders (business letter,
 * DIN 5008 form B: address window, info block, footer with the legally
 * required company details on every page). German or English, in the
 * document's currency.
 */
const PDFDocument = require('pdfkit');

const FONT_REGULAR = require.resolve('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf');
const FONT_BOLD = require.resolve('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf');

const MM = 72 / 25.4;
const PAGE = { width: 210 * MM, height: 297 * MM };
const LEFT = 25 * MM;
const RIGHT = PAGE.width - 20 * MM;
const WIDTH = RIGHT - LEFT;
const FOOTER_TOP = PAGE.height - 30 * MM;
const COLOR = { text: '#1a1a1a', muted: '#666666', line: '#cccccc', accent: '#1f3a5f' };

const TITLES = {
  quote: 'Angebot', order: 'Auftragsbestätigung', delivery: 'Lieferschein', invoice: 'Rechnung', credit_note: 'Rechnungskorrektur',
};

/** All printed texts. Functions get the values they need. */
const TEXT = {
  de: {
    locale: 'de-DE',
    titles: TITLES,
    numberLabel: { quote: 'Angebotsnr.', order: 'Auftragsnr.', delivery: 'Lieferscheinnr.', invoice: 'Rechnungsnr.', credit_note: 'Korrekturnr.' },
    draft: 'Entwurf', draftMark: 'ENTWURF', date: 'Datum', customerNo: 'Kundennr.', yourOrder: 'Ihre Bestellung', leitweg: 'Leitweg-ID',
    servicePeriod: 'Leistungszeitraum', serviceDate: 'Leistungsdatum', deliveryDate: 'Liefertermin', validUntil: 'Gültig bis',
    yourVat: 'Ihre USt-IdNr.', ourVat: 'Unsere USt-IdNr.',
    intro: {
      quote: 'Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
      order: 'Vielen Dank für Ihren Auftrag, den wir hiermit wie folgt bestätigen:',
      delivery: 'Wir liefern Ihnen folgende Positionen:',
      invoice: 'Für unsere Lieferungen und Leistungen berechnen wir Ihnen:',
      credit_note: null,
    },
    cols: { pos: 'Pos.', desc: 'Bezeichnung', qty: 'Menge', unitPrice: 'Einzelpreis', vat: 'USt.', total: 'Gesamt', item: 'Artikel' },
    discount: 'Rabatt',
    net: 'Nettobetrag',
    vatPlus: (rate, base) => `zzgl. ${rate} % USt. auf ${base}`,
    vatLine: (rate, base) => `USt. ${rate} % auf ${base}`,
    grandTotal: 'Gesamtbetrag', creditTotal: 'Gutschriftsbetrag',
    pay: (amount, due, hasIban, ref) => `Bitte überweisen Sie den Betrag von ${amount} bis zum ${due} ohne Abzug${hasIban ? ' auf das unten genannte Konto' : ''}. Verwendungszweck: ${ref}.`,
    skonto: (until, pct, amount, payAmount) => `Bei Zahlung bis zum ${until} gewähren wir ${pct} % Skonto (${amount}), Zahlbetrag ${payAmount}.`,
    received: 'Ware vollständig und unbeschädigt erhalten (Datum, Unterschrift)',
    page: (i, n) => `Seite ${i} von ${n}`,
    phone: 'Tel.', directors: 'Geschäftsführung', vatId: 'USt-IdNr.', taxNo: 'Steuernr.',
    units: {},
    dunningTitles: { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: 'Letzte Mahnung' },
    invoiceNo: 'Rechnungsnr.',
    dunningIntro: {
      1: (no, date) => `sicher ist es Ihrer Aufmerksamkeit entgangen, dass unsere Rechnung ${no} vom ${date} noch nicht vollständig beglichen ist.`,
      2: (no, date) => `leider konnten wir zu unserer Rechnung ${no} vom ${date} trotz unserer Zahlungserinnerung noch keinen vollständigen Zahlungseingang feststellen.`,
      3: (no, date) => `trotz unserer bisherigen Mahnungen ist unsere Rechnung ${no} vom ${date} weiterhin offen. Wir fordern Sie hiermit letztmalig zur Zahlung auf.`,
    },
    salutation: 'Sehr geehrte Damen und Herren,',
    dunningRows: ['Rechnungsbetrag', 'Bereits bezahlt / gutgeschrieben', 'Offener Betrag', 'Mahngebühr', 'Zu zahlender Betrag'],
    dunningPay: (due, hasIban, no, first) => `Bitte überweisen Sie den Betrag bis zum ${due}${hasIban ? ' auf das unten genannte Konto' : ''} unter Angabe der Rechnungsnummer ${no}.${first ? ' Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.' : ''}`,
    regards: 'Mit freundlichen Grüßen',
  },
  en: {
    locale: 'en-GB',
    titles: { quote: 'Quotation', order: 'Order Confirmation', delivery: 'Delivery Note', invoice: 'Invoice', credit_note: 'Credit Note' },
    numberLabel: { quote: 'Quotation no.', order: 'Order no.', delivery: 'Delivery note no.', invoice: 'Invoice no.', credit_note: 'Credit note no.' },
    draft: 'Draft', draftMark: 'DRAFT', date: 'Date', customerNo: 'Customer no.', yourOrder: 'Your order', leitweg: 'Buyer reference',
    servicePeriod: 'Supply period', serviceDate: 'Tax point', deliveryDate: 'Delivery date', validUntil: 'Valid until',
    yourVat: 'Your VAT no.', ourVat: 'Our VAT no.',
    intro: {
      quote: 'Thank you for your enquiry. We are pleased to quote as follows:',
      order: 'Thank you for your order, which we confirm as follows:',
      delivery: 'We are delivering the following items:',
      invoice: 'We invoice you for the following goods and services:',
      credit_note: null,
    },
    cols: { pos: 'No.', desc: 'Description', qty: 'Qty', unitPrice: 'Unit price', vat: 'VAT', total: 'Amount', item: 'Item' },
    discount: 'Discount',
    net: 'Net amount',
    vatPlus: (rate, base) => `VAT ${rate} % on ${base}`,
    vatLine: (rate, base) => `VAT ${rate} % on ${base}`,
    grandTotal: 'Total due', creditTotal: 'Credit total',
    pay: (amount, due, hasIban, ref) => `Please pay ${amount} by ${due}${hasIban ? ' to the bank account below' : ''}, quoting reference ${ref}.`,
    skonto: (until, pct, amount, payAmount) => `For payment by ${until} we grant a ${pct} % early payment discount (${amount}); amount payable ${payAmount}.`,
    received: 'Goods received complete and undamaged (date, signature)',
    page: (i, n) => `Page ${i} of ${n}`,
    phone: 'Tel.', directors: 'Directors', vatId: 'VAT no.', taxNo: 'Tax no.',
    units: { Stk: 'pcs', 'Stk.': 'pcs', psch: 'lot', Std: 'h' },
    dunningTitles: { 1: 'Payment Reminder', 2: 'Second Reminder', 3: 'Final Reminder' },
    invoiceNo: 'Invoice no.',
    dunningIntro: {
      1: (no, date) => `our records show that invoice ${no} dated ${date} has not yet been paid in full. This may simply have been overlooked.`,
      2: (no, date) => `despite our reminder, we have not yet received full payment of invoice ${no} dated ${date}.`,
      3: (no, date) => `despite our previous reminders, invoice ${no} dated ${date} is still outstanding. This is our final request for payment.`,
    },
    salutation: 'Dear Sir or Madam,',
    dunningRows: ['Invoice amount', 'Already paid / credited', 'Outstanding', 'Late payment fee', 'Amount now due'],
    dunningPay: (due, hasIban, no, first) => `Please pay this amount by ${due}${hasIban ? ' to the bank account below' : ''}, quoting invoice number ${no}.${first ? ' If you have already paid, please disregard this letter.' : ''}`,
    regards: 'Yours faithfully',
  },
};

/** Formatters for one document: language + currency. */
function formatter(lang = 'de', currency = 'EUR') {
  const t = TEXT[lang] || TEXT.de;
  const nf = (opts) => new Intl.NumberFormat(t.locale, opts);
  const date = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return lang === 'en' ? `${d}/${m}/${y}` : `${d}.${m}.${y}`;
  };
  return {
    t,
    date,
    num: (v, max = 3) => nf({ maximumFractionDigits: max }).format(Number(v)),
    money: (v) => nf({ style: 'currency', currency }).format(Number(v)),
    unitPrice: (v) => nf({ style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(v)),
    unit: (u) => t.units[u] || u,
  };
}

/** Postcode and town of the company, in its country's order (UK and Ireland: town first). */
const companyPostal = (c) => (['GB', 'IE'].includes(c.country) ? [c.city, c.postal_code] : [c.postal_code, c.city]).filter(Boolean).join(' ');

const dateDE = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function createDoc(title, f) {
  const doc = new PDFDocument({
    size: 'A4', margins: { top: 20 * MM, bottom: 32 * MM, left: LEFT, right: PAGE.width - RIGHT },
    bufferPages: true, pdfVersion: '1.7', lang: f.t.locale, displayTitle: true,
    info: { Title: title, Producer: 'NOVA', Creator: 'NOVA' },
  });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.font('regular').fillColor(COLOR.text);
  return doc;
}

function footer(doc, company, f) {
  const { t } = f;
  const col = WIDTH / 3;
  const y = FOOTER_TOP + 4;
  const name = company.legal_name || company.name;
  const blocks = [
    [name, company.street, companyPostal(company), company.phone && `${t.phone} ${company.phone}`, company.email, company.website],
    [company.managing_directors && `${t.directors}: ${company.managing_directors}`, company.register_court, company.register_number,
      company.vat_id && `${t.vatId}: ${company.vat_id}`, company.tax_number && `${t.taxNo}: ${company.tax_number}`],
    [company.bank_name, company.iban && `IBAN: ${company.iban.replace(/(.{4})/g, '$1 ').trim()}`, company.bic && `BIC: ${company.bic}`],
  ];
  doc.moveTo(LEFT, FOOTER_TOP).lineTo(RIGHT, FOOTER_TOP).lineWidth(0.5).strokeColor(COLOR.line).stroke();
  doc.font('regular').fontSize(7).fillColor(COLOR.muted);
  blocks.forEach((lines, i) => {
    doc.text(lines.filter(Boolean).join('\n'), LEFT + i * col, y, { width: col - 6, lineGap: 1 });
  });
  doc.fillColor(COLOR.text);
}

function letterHead(doc, company, { addressText, info, title, draft }, f) {
  // Logo or company name (top right)
  if (company.logo_data_url) {
    try {
      const buf = Buffer.from(company.logo_data_url.split(',')[1], 'base64');
      doc.image(buf, RIGHT - 60 * MM, 12 * MM, { fit: [60 * MM, 22 * MM], align: 'right' });
    } catch { /* invalid image: ignore */ }
  } else {
    doc.font('bold').fontSize(16).fillColor(COLOR.accent).text(company.name, LEFT, 15 * MM, { width: WIDTH, align: 'right' });
  }
  doc.fillColor(COLOR.text);

  // Sender line above the address window (45 mm from top)
  const sender = [company.legal_name || company.name, company.street, companyPostal(company)].filter(Boolean).join(' · ');
  doc.font('regular').fontSize(7).fillColor(COLOR.muted).text(sender, LEFT, 45 * MM, { width: 85 * MM, underline: false });
  doc.fillColor(COLOR.text).fontSize(10).text(addressText, LEFT, 51 * MM, { width: 85 * MM, lineGap: 1.5 });

  // Info block (right)
  const x = 125 * MM;
  let y = 50 * MM;
  doc.fontSize(8.5);
  for (const [label, value] of info.filter(([, val]) => val)) {
    doc.font('regular').fillColor(COLOR.muted).text(label, x, y, { width: 32 * MM });
    doc.font('regular').fillColor(COLOR.text).text(String(value), x + 32 * MM, y, { width: RIGHT - x - 32 * MM });
    y += 12;
  }

  // Title
  doc.font('bold').fontSize(15).fillColor(COLOR.text).text(title, LEFT, Math.max(100 * MM, y + 10));
  if (draft) {
    doc.save().rotate(-35, { origin: [PAGE.width / 2, PAGE.height / 2] })
      .font('bold').fontSize(90).fillColor('#e8e8e8').opacity(0.6)
      .text(f.t.draftMark, 0, PAGE.height / 2 - 50, { width: PAGE.width, align: 'center' })
      .restore();
    doc.opacity(1).fillColor(COLOR.text);
  }
  doc.moveDown(0.6);
}

function paragraph(doc, text, opts = {}) {
  if (!text) return;
  doc.font('regular').fontSize(9.5).fillColor(COLOR.text).text(text, LEFT, doc.y, { width: WIDTH, lineGap: 2, ...opts });
  doc.moveDown(0.6);
}

/** Line table. Columns depend on whether prices are shown. */
function linesTable(doc, lines, { prices }, f) {
  const c = f.t.cols;
  const cols = prices
    ? [[c.pos, 9 * MM, 'left'], [c.desc, 0, 'left'], [c.qty, 22 * MM, 'right'], [c.unitPrice, 25 * MM, 'right'], [c.vat, 12 * MM, 'right'], [c.total, 25 * MM, 'right']]
    : [[c.pos, 9 * MM, 'left'], [c.item, 28 * MM, 'left'], [c.desc, 0, 'left'], [c.qty, 28 * MM, 'right']];
  const fixed = cols.reduce((s, col) => s + col[1], 0);
  cols.forEach((col) => { if (!col[1]) col[1] = WIDTH - fixed; });

  const header = () => {
    const y = doc.y;
    doc.rect(LEFT, y - 2, WIDTH, 16).fill('#f2f4f7');
    doc.font('bold').fontSize(8.5).fillColor(COLOR.text);
    let x = LEFT;
    for (const [label, w, align] of cols) { doc.text(label, x + 3, y + 2, { width: w - 6, align }); x += w; }
    doc.y = y + 18;
  };
  header();

  for (const l of lines) {
    const desc = l.discount_percent > 0 && prices ? `${l.description}\n${f.t.discount} ${f.num(l.discount_percent, 2)} %` : l.description;
    const qty = `${f.num(l.quantity)} ${f.unit(l.unit)}`;
    const cells = prices
      ? [String(l.position), (l.item_code ? `${l.item_code} · ` : '') + desc, qty, f.unitPrice(l.unit_price), `${f.num(l.tax_rate, 2)} %`, f.money(l.line_net)]
      : [String(l.position), l.item_code || '', l.description, qty];
    doc.font('regular').fontSize(9);
    const height = Math.max(...cells.map((text, i) => doc.heightOfString(text, { width: cols[i][1] - 6 }))) + 6;
    if (doc.y + height > FOOTER_TOP - 10) { doc.addPage(); doc.y = 25 * MM; header(); }
    const y = doc.y;
    let x = LEFT;
    cells.forEach((text, i) => { doc.text(text, x + 3, y + 2, { width: cols[i][1] - 6, align: cols[i][2] }); x += cols[i][1]; });
    doc.moveTo(LEFT, y + height).lineTo(RIGHT, y + height).lineWidth(0.3).strokeColor(COLOR.line).stroke();
    doc.y = y + height + 2;
  }
  doc.moveDown(0.4);
}

function totals(doc, d, f) {
  const { t } = f;
  const x = RIGHT - 85 * MM;
  const row = (label, value, bold = false) => {
    if (doc.y > FOOTER_TOP - 30) { doc.addPage(); doc.y = 25 * MM; }
    const y = doc.y;
    doc.font(bold ? 'bold' : 'regular').fontSize(bold ? 10.5 : 9.5);
    doc.text(label, x, y, { width: 55 * MM });
    doc.text(value, x + 55 * MM, y, { width: 30 * MM, align: 'right' });
    doc.y = y + (bold ? 16 : 13);
  };
  row(t.net, f.money(d.net_total));
  for (const b of d.tax_breakdown) {
    if (b.tax_category === 'S') row(t.vatPlus(f.num(b.tax_rate, 2), f.money(b.net_amount)), f.money(b.tax_amount));
    else row(t.vatLine(f.num(b.tax_rate, 2), f.money(b.net_amount)), f.money(b.tax_amount));
  }
  doc.moveTo(x, doc.y).lineTo(RIGHT, doc.y).lineWidth(0.8).strokeColor(COLOR.text).stroke();
  doc.y += 4;
  row(d.doc_type === 'credit_note' ? t.creditTotal : t.grandTotal, f.money(d.gross_total), true);
  doc.x = LEFT;
  doc.moveDown(0.8);
}

function paymentText(d, company, f) {
  if (d.doc_type !== 'invoice') return null;
  const parts = [];
  if (d.due_date) parts.push(f.t.pay(f.money(d.gross_total), f.date(d.due_date), !!company.iban, d.number || '—'));
  if (d.skonto_days && Number(d.skonto_percent) > 0) {
    const skonto = Math.round(Number(d.gross_total) * Number(d.skonto_percent)) / 100;
    parts.push(f.t.skonto(f.date(addDays(d.document_date, d.skonto_days)), f.num(d.skonto_percent, 2), f.money(skonto), f.money(Number(d.gross_total) - skonto)));
  }
  return parts.join('\n');
}

function finish(doc, company, f) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // allow writing into the footer area
    footer(doc, company, f);
    doc.font('regular').fontSize(7).fillColor(COLOR.muted)
      .text(f.t.page(i + 1, range.count), LEFT, PAGE.height - 10 * MM, { width: WIDTH, align: 'right' });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/**
 * Renders a sales document.
 * d: document with lines (from services/sales.loadDocument), company, customer (for customer number).
 */
async function renderSalesDocument(d, company, customer) {
  const f = formatter(d.language, d.currency || company.currency);
  const { t } = f;
  const title = `${t.titles[d.doc_type]}${d.number ? ` ${d.number}` : ''}`;
  const doc = createDoc(title, f);
  const done = toBuffer(doc);
  const draft = !d.locked;
  const billing = ['invoice', 'credit_note'].includes(d.doc_type);

  const info = [
    [t.numberLabel[d.doc_type], d.number || t.draft],
    [t.date, f.date(d.document_date)],
    [t.customerNo, customer?.customer_number],
    [t.yourOrder, d.customer_reference],
    [t.leitweg, billing ? (d.buyer_reference && d.buyer_reference !== customer?.leitweg_id ? null : d.buyer_reference) : null],
    [d.service_period_end ? t.servicePeriod : t.serviceDate, billing
      ? (d.service_period_end ? `${f.date(d.service_date)} – ${f.date(d.service_period_end)}` : f.date(d.service_date || d.document_date)) : null],
    [t.deliveryDate, d.doc_type === 'order' ? f.date(d.delivery_date) : null],
    [t.validUntil, d.doc_type === 'quote' ? f.date(d.valid_until) : null],
    [t.yourVat, d.customer_vat_id && d.tax_treatment !== 'domestic' ? d.customer_vat_id : null],
    [t.ourVat, d.tax_treatment === 'intra_eu' ? company.vat_id : null],
  ];

  letterHead(doc, company, { addressText: d.customer_address || d.customer_name, info, title, draft }, f);
  paragraph(doc, d.intro_text || t.intro[d.doc_type]);

  const prices = d.doc_type !== 'delivery';
  linesTable(doc, d.lines, { prices }, f);
  if (prices) totals(doc, d, f);

  paragraph(doc, paymentText(d, company, f));
  paragraph(doc, d.closing_text);
  if (d.doc_type === 'delivery') {
    doc.moveDown(2);
    const y = doc.y;
    doc.moveTo(LEFT, y + 20).lineTo(LEFT + 70 * MM, y + 20).lineWidth(0.5).strokeColor(COLOR.text).stroke();
    doc.font('regular').fontSize(8).text(t.received, LEFT, y + 24, { width: 100 * MM });
  }
  paragraph(doc, company.invoice_footer_text && billing ? company.invoice_footer_text : null);

  finish(doc, company, f);
  return done;
}

/** Payment reminder (Zahlungserinnerung / Mahnung), in the invoice's language and currency. */
async function renderDunning(notice, invoice, company, customer) {
  const f = formatter(invoice.language, invoice.currency || company.currency);
  const { t } = f;
  const title = `${t.dunningTitles[notice.level]}${notice.number ? ` ${notice.number}` : ''}`;
  const doc = createDoc(title, f);
  const done = toBuffer(doc);
  letterHead(doc, company, {
    addressText: invoice.customer_address || invoice.customer_name,
    info: [[t.date, f.date(notice.notice_date)], [t.customerNo, customer?.customer_number], [t.invoiceNo, invoice.number]],
    title,
  }, f);
  const intro = t.dunningIntro[notice.level](invoice.number, f.date(invoice.document_date));
  paragraph(doc, `${t.salutation}\n\n${intro}`);
  const [lAmount, lPaid, lOpen, lFee, lDue] = t.dunningRows;
  const rows = [
    [lAmount, f.money(invoice.gross_total)],
    [lPaid, f.money(Number(invoice.paid_total) + Number(invoice.credited_total))],
    [lOpen, f.money(notice.open_amount)],
    ...(Number(notice.fee) > 0 ? [[lFee, f.money(notice.fee)]] : []),
    [lDue, f.money(Number(notice.open_amount) + Number(notice.fee))],
  ];
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.font(label === lDue ? 'bold' : 'regular').fontSize(9.5);
    doc.text(label, LEFT, y, { width: 90 * MM });
    doc.text(value, LEFT + 90 * MM, y, { width: 35 * MM, align: 'right' });
    doc.y = y + 14;
  }
  doc.x = LEFT;
  doc.moveDown(0.8);
  paragraph(doc, t.dunningPay(f.date(notice.new_due_date), !!company.iban, invoice.number, notice.level === 1));
  paragraph(doc, t.regards);
  paragraph(doc, company.legal_name || company.name);
  finish(doc, company, f);
  return done;
}

module.exports = { renderSalesDocument, renderDunning, TITLES, TEXT, dateDE, formatter };
