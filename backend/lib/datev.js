/**
 * DATEV export: "Buchungsstapel" in the DATEV format (EXTF, version 700,
 * format version 13), the standard way to hand bookings to a German tax
 * advisor (Steuerberater).
 *
 * Invoices are booked customer account (debit) against the revenue account
 * matching the VAT case; the revenue accounts are DATEV "automatic accounts",
 * so no tax key (BU-Schlüssel) is needed. Payments are booked bank against
 * customer account with the invoice number in "Belegfeld 1", so DATEV clears
 * the open item; early-payment discounts go into the "Skonto" field.
 */

const COLUMNS = (() => {
  const c = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basisumsatz', 'WKZ Basisumsatz',
    'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto',
    'Buchungstext', 'Postensperre', 'Diverse Adressnummer', 'Geschäftspartnerbank', 'Sachverhalt', 'Zinssperre', 'Beleglink'];
  for (let n = 1; n <= 8; n += 1) c.push(`Beleginfo – Art ${n}`, `Beleginfo – Inhalt ${n}`);
  c.push('KOST1 – Kostenstelle', 'KOST2 – Kostenstelle', 'Kost Menge', 'EU-Land u. USt-IdNr.', 'EU-Steuersatz',
    'Abw. Versteuerungsart', 'Sachverhalt L+L', 'Funktionsergänzung L+L', 'BU 49 Hauptfunktionstyp',
    'BU 49 Hauptfunktionsnummer', 'BU 49 Funktionsergänzung');
  for (let n = 1; n <= 20; n += 1) c.push(`Zusatzinformation – Art ${n}`, `Zusatzinformation – Inhalt ${n}`);
  c.push('Stück', 'Gewicht', 'Zahlweise', 'Forderungsart', 'Veranlagungsjahr', 'Zugeordnete Fälligkeit', 'Skontotyp',
    'Auftragsnummer', 'Buchungstyp', 'USt-Schlüssel (Anzahlungen)', 'EU-Mitgliedstaat (Anzahlungen)',
    'Sachverhalt L+L (Anzahlungen)', 'EU-Steuersatz (Anzahlungen)', 'Erlöskonto (Anzahlungen)', 'Herkunft-Kz', 'Leerfeld',
    'KOST-Datum', 'SEPA-Mandatsreferenz', 'Skontosperre', 'Gesellschaftername', 'Beteiligtennummer',
    'Identifikationsnummer', 'Zeichnernummer', 'Postensperre bis', 'Bezeichnung', 'Kennzeichen', 'Festschreibung',
    'Leistungsdatum', 'Datum Zuord.', 'Fälligkeit', 'Generalumkehr', 'Steuersatz', 'Land', 'Abrechnungsreferent',
    'BVV-Position', 'EU-Mitgliedstaat u. UStID (Ursprung)', 'EU-Steuersatz (Ursprung)', 'Abw. Skontokonto');
  return c;
})();

// Standard accounts (DATEV automatic revenue accounts) per chart of accounts.
const ACCOUNTS = {
  SKR03: { revenue19: 8400, revenue7: 8300, intraEu: 8125, export: 8120, smallBusiness: 8195, bank: 1200 },
  SKR04: { revenue19: 4400, revenue7: 4300, intraEu: 4125, export: 4120, smallBusiness: 4185, bank: 1800 },
};

const DEFAULT_DEBTOR = 10000; // collective debtor if a customer has no own account

function revenueAccount(chart, b) {
  const a = ACCOUNTS[chart];
  if (b.tax_category === 'K') return a.intraEu;
  if (b.tax_category === 'G') return a.export;
  if (b.tax_category === 'E') return a.smallBusiness;
  return Number(b.tax_rate) === 7 ? a.revenue7 : a.revenue19;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

const quote = (s) => (s === null || s === undefined || s === '' ? '' : `"${String(s).replace(/"/g, '""')}"`);
const decimal = (n) => Number(n).toFixed(2).replace('.', ',');
const ddmm = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
const ddmmyyyy = (iso) => (iso ? `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}` : '');
const yyyymmdd = (iso) => iso.replace(/-/g, '').slice(0, 8);
/** "Belegfeld 1" allows only a-z A-Z 0-9 $ & % * + - / (max. 36). */
const belegfeld = (s) => String(s || '').replace(/[^a-zA-Z0-9$&%*+\-/]/g, '').slice(0, 36);
const text = (s, max) => String(s || '').replace(/[\r\n;]+/g, ' ').trim().slice(0, max);

function row(values) {
  const r = new Array(COLUMNS.length).fill('');
  for (const [name, value] of Object.entries(values)) {
    const i = COLUMNS.indexOf(name);
    if (i < 0) throw new Error(`Unknown DATEV column ${name}`);
    r[i] = value;
  }
  return r.join(';');
}

// Windows-1252 encoding (what DATEV expects for EXTF files).
const CP1252_EXTRA = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
function encodeCp1252(str) {
  const out = Buffer.alloc(str.length);
  let i = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (CP1252_EXTRA[ch] !== undefined) out[i] = CP1252_EXTRA[ch];
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out[i] = code;
    else out[i] = 0x3f; // '?'
    i += 1;
  }
  return out.subarray(0, i);
}

/**
 * Builds the Buchungsstapel file.
 * company: companies row; from/to: 'YYYY-MM-DD';
 * documents: issued invoices/credit notes with tax_breakdown and customer datev_account;
 * payments: [{ payment_date, amount, skonto_amount, invoice_number, customer_name, datev_account }]
 */
function buildBuchungsstapel({ company, from, to, documents, payments, exportedBy, now = new Date() }) {
  const chart = company.datev_chart || 'SKR03';
  const a = ACCOUNTS[chart];
  const fyStart = `${from.slice(0, 4)}0101`;
  const created = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);

  const header = [
    '"EXTF"', 700, 21, '"Buchungsstapel"', 13, created, '', '"NO"', quote(text(exportedBy, 25)), '',
    company.datev_consultant_number, company.datev_client_number, fyStart, 4, yyyymmdd(from), yyyymmdd(to),
    quote(text(`NOVA ${from} bis ${to}`, 30)), '', 1, 0, 0, '"EUR"', '', '', '', '', `"${chart.slice(3)}"`, '', '', '', '',
  ].join(';');

  const lines = [header, COLUMNS.join(';')];

  for (const d of documents) {
    const debtor = d.datev_account || DEFAULT_DEBTOR;
    // Invoice: debit customer; credit note: credit customer.
    const side = d.doc_type === 'credit_note' ? 'H' : 'S';
    for (const b of d.tax_breakdown) {
      const gross = Number(b.net_amount) + Number(b.tax_amount);
      if (gross === 0) continue;
      lines.push(row({
        'Umsatz (ohne Soll/Haben-Kz)': decimal(Math.abs(gross)),
        'Soll/Haben-Kennzeichen': quote(gross < 0 ? (side === 'S' ? 'H' : 'S') : side),
        'WKZ Umsatz': quote('EUR'),
        Konto: debtor,
        'Gegenkonto (ohne BU-Schlüssel)': revenueAccount(chart, b),
        Belegdatum: ddmm(d.document_date),
        'Belegfeld 1': quote(belegfeld(d.number)),
        'Belegfeld 2': d.due_date ? ddmmyyyy(d.due_date) : '',
        Buchungstext: quote(text(`${d.doc_type === 'credit_note' ? 'Gutschrift ' : ''}${d.customer_name}`, 60)),
        'EU-Land u. USt-IdNr.': b.tax_category === 'K' ? quote(text(d.customer_vat_id, 15)) : '',
        Leistungsdatum: ddmmyyyy(d.service_date || d.document_date),
        Fälligkeit: ddmmyyyy(d.due_date),
        Festschreibung: 0,
      }));
    }
  }

  for (const p of payments) {
    const amount = Number(p.amount);
    if (amount === 0) continue;
    lines.push(row({
      'Umsatz (ohne Soll/Haben-Kz)': decimal(Math.abs(amount)),
      'Soll/Haben-Kennzeichen': quote(amount > 0 ? 'S' : 'H'),
      'WKZ Umsatz': quote('EUR'),
      Konto: a.bank,
      'Gegenkonto (ohne BU-Schlüssel)': p.datev_account || DEFAULT_DEBTOR,
      Belegdatum: ddmm(p.payment_date),
      'Belegfeld 1': quote(belegfeld(p.invoice_number)),
      Skonto: Number(p.skonto_amount) > 0 ? decimal(p.skonto_amount) : '',
      Buchungstext: quote(text(`Zahlung ${p.customer_name}`, 60)),
      Festschreibung: 0,
    }));
  }

  return encodeCp1252(`${lines.join('\r\n')}\r\n`);
}

module.exports = { buildBuchungsstapel, COLUMNS, ACCOUNTS, revenueAccount, encodeCp1252, belegfeld };
