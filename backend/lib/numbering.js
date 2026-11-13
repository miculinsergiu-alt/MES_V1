/**
 * Gap-free document numbers (GoBD).
 *
 * The counter row is locked (SELECT ... FOR UPDATE) inside the transaction
 * that issues the document. If anything fails, the transaction rolls back and
 * the number is never used, so the sequence has no gaps and no duplicates.
 */
const db = require('../db');
const { badRequest } = require('./errors');

const DEFAULTS = {
  quote: { prefix: 'AN', yearly_reset: 1, digits: 5 },        // Angebot
  order: { prefix: 'AB', yearly_reset: 1, digits: 5 },        // Auftragsbestätigung
  delivery: { prefix: 'LS', yearly_reset: 1, digits: 5 },     // Lieferschein
  invoice: { prefix: 'RE', yearly_reset: 1, digits: 5 },      // Rechnung
  credit_note: { prefix: 'RK', yearly_reset: 1, digits: 5 },  // Rechnungskorrektur
  dunning: { prefix: 'MA', yearly_reset: 1, digits: 5 },      // Mahnung
  customer: { prefix: '', yearly_reset: 0, digits: 5, start: 10001 }, // usable as DATEV debtor account
};

async function ensureSeries(docType) {
  const d = DEFAULTS[docType];
  if (!d) throw new Error(`Unknown number series ${docType}`);
  await db.run(`
    INSERT INTO number_series (doc_type, prefix, yearly_reset, digits, next_number)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT (company_id, doc_type) DO NOTHING`,
  [docType, d.prefix, d.yearly_reset, d.digits, d.start || 1]);
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

module.exports = { nextNumber, peekNumber, ensureSeries, DEFAULTS };
