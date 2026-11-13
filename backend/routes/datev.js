const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { badRequest } = require('../lib/errors');
const { buildBuchungsstapel } = require('../lib/datev');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken, requireRole('administrator', 'accounting'));

// GET /api/datev/export?from=2026-01-01&to=2026-01-31 — DATEV Buchungsstapel (CSV)
router.get('/export', h(async (req, res) => {
  const { from, to } = v.query(req, v.z.object({ from: v.date, to: v.date }));
  if (from > to) throw badRequest('"from" must not be after "to"');
  if (from.slice(0, 4) !== to.slice(0, 4)) throw badRequest('DATEV exports must stay within one fiscal year');

  const company = await db.get('SELECT * FROM companies WHERE id = nova_company_id()');
  if (!company.datev_consultant_number || !company.datev_client_number) {
    throw badRequest('Enter the DATEV consultant number (Beraternummer) and client number (Mandantennummer) in Settings first');
  }

  const documents = (await db.all(`
    SELECT d.*, c.datev_account FROM sales_documents d JOIN customers c ON c.id = d.customer_id
    WHERE d.doc_type IN ('invoice','credit_note') AND d.locked = 1 AND d.document_date BETWEEN ? AND ?
    ORDER BY d.document_date, d.number`, [from, to]))
    .map((d) => ({ ...d, tax_breakdown: JSON.parse(d.tax_breakdown || '[]') }));

  const payments = await db.all(`
    SELECT p.payment_date, p.amount, p.skonto_amount, d.number AS invoice_number, d.customer_name, c.datev_account
    FROM payments p
    JOIN sales_documents d ON d.id = p.document_id
    JOIN customers c ON c.id = d.customer_id
    WHERE p.payment_date BETWEEN ? AND ?
    ORDER BY p.payment_date, p.id`, [from, to]);

  const file = buildBuchungsstapel({
    company, from, to, documents, payments,
    exportedBy: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.badge_number,
  });

  res.setHeader('Content-Type', 'text/csv; charset=windows-1252');
  res.setHeader('Content-Disposition', `attachment; filename="EXTF_Buchungsstapel_${from}_${to}.csv"`);
  res.setHeader('X-Datev-Bookings', String(documents.length + payments.length));
  res.end(file);
}));

module.exports = router;
