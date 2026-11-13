/**
 * PDF layout for sales documents and payment reminders (German business
 * letter, DIN 5008 form B: address window, info block, footer with the
 * legally required company details on every page).
 */
const PDFDocument = require('pdfkit');
const { formatEUR } = require('../lib/money');

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

const dateDE = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');
const num = (v, max = 3) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: max }).format(Number(v));
const eur = (v) => formatEUR(Number(v));
const unitPrice = (v) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(v)) + ' €';

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function createDoc(title) {
  const doc = new PDFDocument({
    size: 'A4', margins: { top: 20 * MM, bottom: 32 * MM, left: LEFT, right: PAGE.width - RIGHT },
    bufferPages: true, pdfVersion: '1.7', lang: 'de-DE', displayTitle: true,
    info: { Title: title, Producer: 'NOVA', Creator: 'NOVA' },
  });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.font('regular').fillColor(COLOR.text);
  return doc;
}

function footer(doc, company) {
  const col = WIDTH / 3;
  const y = FOOTER_TOP + 4;
  const name = company.legal_name || company.name;
  const blocks = [
    [name, company.street, [company.postal_code, company.city].filter(Boolean).join(' '), company.phone && `Tel. ${company.phone}`, company.email, company.website],
    [company.managing_directors && `Geschäftsführung: ${company.managing_directors}`, company.register_court, company.register_number,
      company.vat_id && `USt-IdNr.: ${company.vat_id}`, company.tax_number && `Steuernr.: ${company.tax_number}`],
    [company.bank_name, company.iban && `IBAN: ${company.iban.replace(/(.{4})/g, '$1 ').trim()}`, company.bic && `BIC: ${company.bic}`],
  ];
  doc.moveTo(LEFT, FOOTER_TOP).lineTo(RIGHT, FOOTER_TOP).lineWidth(0.5).strokeColor(COLOR.line).stroke();
  doc.font('regular').fontSize(7).fillColor(COLOR.muted);
  blocks.forEach((lines, i) => {
    doc.text(lines.filter(Boolean).join('\n'), LEFT + i * col, y, { width: col - 6, lineGap: 1 });
  });
  doc.fillColor(COLOR.text);
}

function letterHead(doc, company, { addressText, info, title, draft }) {
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
  const sender = [company.legal_name || company.name, company.street, [company.postal_code, company.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
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
      .text('ENTWURF', 0, PAGE.height / 2 - 50, { width: PAGE.width, align: 'center' })
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
function linesTable(doc, lines, { prices }) {
  const cols = prices
    ? [['Pos.', 9 * MM, 'left'], ['Bezeichnung', 0, 'left'], ['Menge', 22 * MM, 'right'], ['Einzelpreis', 25 * MM, 'right'], ['USt.', 12 * MM, 'right'], ['Gesamt', 25 * MM, 'right']]
    : [['Pos.', 9 * MM, 'left'], ['Artikel', 28 * MM, 'left'], ['Bezeichnung', 0, 'left'], ['Menge', 28 * MM, 'right']];
  const fixed = cols.reduce((s, c) => s + c[1], 0);
  cols.forEach((c) => { if (!c[1]) c[1] = WIDTH - fixed; });

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
    const desc = l.discount_percent > 0 && prices ? `${l.description}\nRabatt ${num(l.discount_percent, 2)} %` : l.description;
    const cells = prices
      ? [String(l.position), (l.item_code ? `${l.item_code} · ` : '') + desc, `${num(l.quantity)} ${l.unit}`, unitPrice(l.unit_price), `${num(l.tax_rate, 2)} %`, eur(l.line_net)]
      : [String(l.position), l.item_code || '', l.description, `${num(l.quantity)} ${l.unit}`];
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

function totals(doc, d) {
  const x = RIGHT - 85 * MM;
  const row = (label, value, bold = false) => {
    if (doc.y > FOOTER_TOP - 30) { doc.addPage(); doc.y = 25 * MM; }
    const y = doc.y;
    doc.font(bold ? 'bold' : 'regular').fontSize(bold ? 10.5 : 9.5);
    doc.text(label, x, y, { width: 55 * MM });
    doc.text(value, x + 55 * MM, y, { width: 30 * MM, align: 'right' });
    doc.y = y + (bold ? 16 : 13);
  };
  row('Nettobetrag', eur(d.net_total));
  for (const b of d.tax_breakdown) {
    if (b.tax_category === 'S') row(`zzgl. ${num(b.tax_rate, 2)} % USt. auf ${eur(b.net_amount)}`, eur(b.tax_amount));
    else row(`USt. ${num(b.tax_rate, 2)} % auf ${eur(b.net_amount)}`, eur(b.tax_amount));
  }
  doc.moveTo(x, doc.y).lineTo(RIGHT, doc.y).lineWidth(0.8).strokeColor(COLOR.text).stroke();
  doc.y += 4;
  row(d.doc_type === 'credit_note' ? 'Gutschriftsbetrag' : 'Gesamtbetrag', eur(d.gross_total), true);
  doc.x = LEFT;
  doc.moveDown(0.8);
}

function paymentText(d, company) {
  if (d.doc_type !== 'invoice') return null;
  const parts = [];
  if (d.due_date) parts.push(`Bitte überweisen Sie den Betrag von ${eur(d.gross_total)} bis zum ${dateDE(d.due_date)} ohne Abzug${company.iban ? ` auf das unten genannte Konto` : ''}. Verwendungszweck: ${d.number || '—'}.`);
  if (d.skonto_days && Number(d.skonto_percent) > 0) {
    const skonto = Math.round(Number(d.gross_total) * Number(d.skonto_percent)) / 100;
    parts.push(`Bei Zahlung bis zum ${dateDE(addDays(d.document_date, d.skonto_days))} gewähren wir ${num(d.skonto_percent, 2)} % Skonto (${eur(skonto)}), Zahlbetrag ${eur(Number(d.gross_total) - skonto)}.`);
  }
  return parts.join('\n');
}

function finish(doc, company) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // allow writing into the footer area
    footer(doc, company);
    doc.font('regular').fontSize(7).fillColor(COLOR.muted)
      .text(`Seite ${i + 1} von ${range.count}`, LEFT, PAGE.height - 10 * MM, { width: WIDTH, align: 'right' });
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
  const title = `${TITLES[d.doc_type]}${d.number ? ` ${d.number}` : ''}`;
  const doc = createDoc(title);
  const done = toBuffer(doc);
  const draft = !d.locked;

  const info = [
    [{ quote: 'Angebotsnr.', order: 'Auftragsnr.', delivery: 'Lieferscheinnr.', invoice: 'Rechnungsnr.', credit_note: 'Korrekturnr.' }[d.doc_type], d.number || 'Entwurf'],
    ['Datum', dateDE(d.document_date)],
    ['Kundennr.', customer?.customer_number],
    ['Ihre Bestellung', d.customer_reference],
    ['Leitweg-ID', d.doc_type === 'invoice' || d.doc_type === 'credit_note' ? (d.buyer_reference && d.buyer_reference !== customer?.leitweg_id ? null : d.buyer_reference) : null],
    [d.service_period_end ? 'Leistungszeitraum' : 'Leistungsdatum', ['invoice', 'credit_note'].includes(d.doc_type)
      ? (d.service_period_end ? `${dateDE(d.service_date)} – ${dateDE(d.service_period_end)}` : dateDE(d.service_date || d.document_date)) : null],
    ['Liefertermin', d.doc_type === 'order' ? dateDE(d.delivery_date) : null],
    ['Gültig bis', d.doc_type === 'quote' ? dateDE(d.valid_until) : null],
    ['Ihre USt-IdNr.', d.customer_vat_id && d.tax_treatment !== 'domestic' ? d.customer_vat_id : null],
    ['Unsere USt-IdNr.', d.tax_treatment === 'intra_eu' ? company.vat_id : null],
  ];

  letterHead(doc, company, { addressText: d.customer_address || d.customer_name, info, title, draft });

  const defaultIntro = {
    quote: 'Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
    order: 'Vielen Dank für Ihren Auftrag, den wir hiermit wie folgt bestätigen:',
    delivery: 'Wir liefern Ihnen folgende Positionen:',
    invoice: 'Für unsere Lieferungen und Leistungen berechnen wir Ihnen:',
    credit_note: null,
  };
  paragraph(doc, d.intro_text || defaultIntro[d.doc_type]);

  const prices = d.doc_type !== 'delivery';
  linesTable(doc, d.lines, { prices });
  if (prices) totals(doc, d);

  paragraph(doc, paymentText(d, company));
  paragraph(doc, d.closing_text);
  if (d.doc_type === 'delivery') {
    doc.moveDown(2);
    const y = doc.y;
    doc.moveTo(LEFT, y + 20).lineTo(LEFT + 70 * MM, y + 20).lineWidth(0.5).strokeColor(COLOR.text).stroke();
    doc.font('regular').fontSize(8).text('Ware vollständig und unbeschädigt erhalten (Datum, Unterschrift)', LEFT, y + 24, { width: 100 * MM });
  }
  paragraph(doc, company.invoice_footer_text && ['invoice', 'credit_note'].includes(d.doc_type) ? company.invoice_footer_text : null);

  finish(doc, company);
  return done;
}

/** Payment reminder (Zahlungserinnerung / Mahnung). */
async function renderDunning(notice, invoice, company, customer) {
  const titles = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: 'Letzte Mahnung' };
  const title = `${titles[notice.level]}${notice.number ? ` ${notice.number}` : ''}`;
  const doc = createDoc(title);
  const done = toBuffer(doc);
  letterHead(doc, company, {
    addressText: invoice.customer_address || invoice.customer_name,
    info: [['Datum', dateDE(notice.notice_date)], ['Kundennr.', customer?.customer_number], ['Rechnungsnr.', invoice.number]],
    title,
  });
  const intro = {
    1: `sicher ist es Ihrer Aufmerksamkeit entgangen, dass unsere Rechnung ${invoice.number} vom ${dateDE(invoice.document_date)} noch nicht vollständig beglichen ist.`,
    2: `leider konnten wir zu unserer Rechnung ${invoice.number} vom ${dateDE(invoice.document_date)} trotz unserer Zahlungserinnerung noch keinen vollständigen Zahlungseingang feststellen.`,
    3: `trotz unserer bisherigen Mahnungen ist unsere Rechnung ${invoice.number} vom ${dateDE(invoice.document_date)} weiterhin offen. Wir fordern Sie hiermit letztmalig zur Zahlung auf.`,
  }[notice.level];
  paragraph(doc, `Sehr geehrte Damen und Herren,\n\n${intro}`);
  const rows = [
    ['Rechnungsbetrag', eur(invoice.gross_total)],
    ['Bereits bezahlt / gutgeschrieben', eur(Number(invoice.paid_total) + Number(invoice.credited_total))],
    ['Offener Betrag', eur(notice.open_amount)],
    ...(Number(notice.fee) > 0 ? [['Mahngebühr', eur(notice.fee)]] : []),
    ['Zu zahlender Betrag', eur(Number(notice.open_amount) + Number(notice.fee))],
  ];
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.font(label.startsWith('Zu zahlender') ? 'bold' : 'regular').fontSize(9.5);
    doc.text(label, LEFT, y, { width: 90 * MM });
    doc.text(value, LEFT + 90 * MM, y, { width: 35 * MM, align: 'right' });
    doc.y = y + 14;
  }
  doc.x = LEFT;
  doc.moveDown(0.8);
  paragraph(doc, `Bitte überweisen Sie den Betrag bis zum ${dateDE(notice.new_due_date)}${company.iban ? ' auf das unten genannte Konto' : ''} unter Angabe der Rechnungsnummer ${invoice.number}.${notice.level === 1 ? ' Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.' : ''}`);
  paragraph(doc, 'Mit freundlichen Grüßen');
  paragraph(doc, company.legal_name || company.name);
  finish(doc, company);
  return done;
}

module.exports = { renderSalesDocument, renderDunning, TITLES, dateDE };
