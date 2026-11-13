/**
 * Payment reminders (Mahnwesen) in three levels:
 *  1 = Zahlungserinnerung, 2 = 1. Mahnung, 3 = letzte Mahnung.
 *
 * An invoice is proposed for the next level when it is overdue by more than
 * the company's grace days and the last reminder is at least 14 days old.
 * Fees (if configured) apply from level 2. Reminder PDFs are archived.
 */
const db = require('../db');
const money = require('../lib/money');
const numbering = require('../lib/numbering');
const pdf = require('./pdf');
const { storeFile } = require('./documents');
const { badRequest, notFound } = require('../lib/errors');

const DAYS_BETWEEN_LEVELS = 14;
const PAY_WITHIN_DAYS = 10;

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

async function today() {
  return (await db.get('SELECT nova_today() AS d')).d;
}

/** Invoices that are due for their next reminder. */
async function proposals() {
  const company = await db.get('SELECT dunning_grace_days FROM companies WHERE id = nova_company_id()');
  const now = await today();
  const rows = await db.all(`
    SELECT id, number, customer_id, customer_name, document_date, due_date, gross_total, paid_total, credited_total,
           dunning_level, last_dunning_date
    FROM sales_documents
    WHERE doc_type = 'invoice' AND status IN ('issued','partially_paid') AND due_date IS NOT NULL AND dunning_level < 3
    ORDER BY due_date`);
  return rows
    .map((r) => ({
      ...r,
      open_amount: money.sumAmounts([r.gross_total, -r.paid_total, -r.credited_total]),
      days_overdue: daysBetween(r.due_date, now),
      next_level: r.dunning_level + 1,
    }))
    .filter((r) => r.open_amount > 0
      && r.days_overdue > company.dunning_grace_days
      && (!r.last_dunning_date || daysBetween(r.last_dunning_date, now) >= DAYS_BETWEEN_LEVELS));
}

/** Creates the next reminder for an invoice and archives its PDF. */
async function createNotice(invoiceId, userId, { force = false } = {}) {
  const inv = await db.get('SELECT * FROM sales_documents WHERE id = ? FOR UPDATE', [invoiceId]);
  if (!inv || inv.doc_type !== 'invoice') throw notFound('Invoice');
  if (!inv.locked || !['issued', 'partially_paid'].includes(inv.status)) throw badRequest('Only open, issued invoices can be dunned');
  if (inv.dunning_level >= 3) throw badRequest('The final reminder has already been sent');

  const now = await today();
  if (!force) {
    const due = (await proposals()).some((p) => p.id === inv.id);
    if (!due) throw badRequest('This invoice is not due for a reminder yet');
  }
  const company = await db.get('SELECT * FROM companies WHERE id = nova_company_id()');
  const level = inv.dunning_level + 1;
  const open = money.sumAmounts([inv.gross_total, -inv.paid_total, -inv.credited_total]);
  if (open <= 0) throw badRequest('Nothing is open on this invoice');
  const fee = level >= 2 ? Number(company.dunning_fee || 0) : 0;
  const number = await numbering.nextNumber('dunning', now);

  const notice = await db.get(`
    INSERT INTO dunning_notices (document_id, number, level, notice_date, open_amount, fee, new_due_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  [inv.id, number, level, now, open, fee, addDays(now, PAY_WITHIN_DAYS), userId]);
  await db.run('UPDATE sales_documents SET dunning_level = ?, last_dunning_date = ? WHERE id = ?', [level, now, inv.id]);

  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [inv.customer_id]);
  const buffer = await pdf.renderDunning(notice, inv, company, customer);
  const titles = { 1: 'Zahlungserinnerung', 2: 'Mahnung', 3: 'Letzte_Mahnung' };
  await storeFile(inv.id, 'pdf', `${titles[level]}_${number}.pdf`, 'application/pdf', buffer, { dunningId: notice.id });
  return notice;
}

async function list(invoiceId) {
  return db.all(`
    SELECT dn.*, df.id AS file_id FROM dunning_notices dn
    LEFT JOIN document_files df ON df.dunning_id = dn.id
    WHERE dn.document_id = ? ORDER BY dn.id`, [invoiceId]);
}

module.exports = { proposals, createNotice, list, addDays };
