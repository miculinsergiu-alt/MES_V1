/**
 * Gap-free document numbers (GoBD).
 *
 * The counter row is locked (SELECT ... FOR UPDATE) inside the transaction
 * that issues the document. If anything fails, the transaction rolls back and
 * the number is never used, so the sequence has no gaps and no duplicates.
 */
const db = require('../db');
const { badRequest } = require('./errors');
const { languageFor } = require('./vat');

const DEFAULTS = {
  quote: { prefix: 'AN', yearly_reset: 1, digits: 5 },        // Angebot
  order: { prefix: 'AB', yearly_reset: 1, digits: 5 },        // Auftragsbestätigung
  delivery: { prefix: 'LS', yearly_reset: 1, digits: 5 },     // Lieferschein
  invoice: { prefix: 'RE', yearly_reset: 1, digits: 5 },      // Rechnung
  credit_note: { prefix: 'RK', yearly_reset: 1, digits: 5 },  // Rechnungskorrektur
  dunning: { prefix: 'MA', yearly_reset: 1, digits: 5 },      // Mahnung
  purchase_order: { prefix: 'BE', yearly_reset: 1, digits: 5 }, // Bestellung
  subcontract_delivery: { prefix: 'LL', yearly_reset: 1, digits: 5 }, // Lieferschein Lohnbearbeitung
  complaint: { prefix: 'QM', yearly_reset: 1, digits: 4 }, // Reklamation (RK is taken by credit notes)
  blanket_order: { prefix: 'RA', yearly_reset: 1, digits: 4 }, // Rahmenauftrag
  project: { prefix: 'PR', yearly_reset: 1, digits: 3 }, // Projekt
  customer: { prefix: '', yearly_reset: 0, digits: 5, start: 10001 }, // usable as DATEV debtor account
};

// English prefixes for companies outside German-speaking countries.
const PREFIXES_EN = {
  quote: 'QT', order: 'OC', delivery: 'DN', invoice: 'INV', credit_note: 'CN', dunning: 'REM',
  purchase_order: 'PO', subcontract_delivery: 'SD', complaint: 'NCR', blanket_order: 'BO', project: 'PR', customer: '',
};

/** Default prefix of a series for a company in this country. */
function defaultPrefix(docType, country) {
  return languageFor(country) === 'en' ? PREFIXES_EN[docType] : DEFAULTS[docType].prefix;
}

async function ensureSeries(docType) {
  const d = DEFAULTS[docType];
  if (!d) throw new Error(`Unknown number series ${docType}`);
  const exists = await db.get('SELECT id FROM number_series WHERE doc_type = ?', [docType]);
  if (exists) return;
  const company = await db.get('SELECT country FROM companies WHERE id = nova_company_id()');
  await db.run(`
    INSERT INTO number_series (doc_type, prefix, yearly_reset, digits, next_number)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT (company_id, doc_type) DO NOTHING`,
  [docType, defaultPrefix(docType, company?.country), d.yearly_reset, d.digits, d.start || 1]);
}

/**
 * After the company country changed: unused series that still carry the other
 * language's default prefix get the default prefix of the new country.
 */
async function adaptPrefixes(country) {
  for (const [docType, d] of Object.entries(DEFAULTS)) {
    const s = await db.get('SELECT * FROM number_series WHERE doc_type = ? FOR UPDATE', [docType]);
    if (!s || Number(s.next_number) !== (d.start || 1)) continue;
    if (![d.prefix, PREFIXES_EN[docType]].includes(s.prefix)) continue; // set by the user
    await db.run('UPDATE number_series SET prefix = ? WHERE id = ?', [defaultPrefix(docType, country), s.id]);
  }
}

function format(series, year, n) {
  const num = String(n).padStart(series.digits, '0');
  if (!series.prefix) return num;
  return series.yearly_reset ? `${series.prefix}-${year}-${num}` : `${series.prefix}-${num}`;
}

/** Takes the next number of a series (must run inside a request transaction). */
async function nextNumber(docType, date) {
  await ensureSeries(docType);
  const year = Number(String(date || '').slice(0, 4)) || new Date().getFullYear();
  const s = await db.get('SELECT * FROM number_series WHERE doc_type = ? FOR UPDATE', [docType]);
  let n = s.next_number;
  // year 0 = series never used: start with next_number (it may have been set by an administrator).
  if (s.yearly_reset && s.year !== 0 && s.year !== year) {
    if (year < s.year) {
      // Back-dated into a previous year: continue that year's sequence would need
      // a separate counter; refuse instead of creating duplicates.
      throw badRequest(`Document date is in ${year}, but numbering already moved on to ${s.year}`);
    }
    n = 1;
  }
  await db.run('UPDATE number_series SET next_number = ?, year = ? WHERE id = ?', [n + 1, s.yearly_reset ? year : s.year, s.id]);
  return format(s, year, n);
}

/** Preview of the next number without using it. */
async function peekNumber(docType, date) {
  await ensureSeries(docType);
  const year = Number(String(date || '').slice(0, 4)) || new Date().getFullYear();
  const s = await db.get('SELECT * FROM number_series WHERE doc_type = ?', [docType]);
  const n = s.yearly_reset && s.year !== 0 && s.year !== year ? 1 : s.next_number;
  return format(s, year, n);
}

module.exports = { nextNumber, peekNumber, ensureSeries, DEFAULTS, adaptPrefixes, defaultPrefix };
