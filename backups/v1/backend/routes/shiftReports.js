const express = require('express');
const { shiftReportsDb } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/shift-reports — all shift reports
router.get('/', authenticateToken, requireRole('area_supervisor','shift_responsible','administrator'), (req, res) => {
  const { shift_id, date_from, date_to } = req.query;
  let sql = 'SELECT * FROM shift_reports WHERE 1=1';
  const params = [];
  if (shift_id) { sql += ' AND shift_id = ?'; params.push(shift_id); }
  if (date_from) { sql += ' AND report_date >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND report_date <= ?'; params.push(date_to); }
  sql += ' ORDER BY report_date DESC, created_at DESC';
  const reports = shiftReportsDb.prepare(sql).all(...params);

  const result = reports.map(r => {
    const issues = shiftReportsDb.prepare('SELECT * FROM report_issues WHERE report_id = ? ORDER BY id').all(r.id);
    return { ...r, issues };
  });
  res.json(result);
});

// GET /api/shift-reports/:id
router.get('/:id', authenticateToken, (req, res) => {
  const report = shiftReportsDb.prepare('SELECT * FROM shift_reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Raportul nu a fost găsit' });
  const issues = shiftReportsDb.prepare('SELECT * FROM report_issues WHERE report_id = ? ORDER BY id').all(report.id);
  res.json({ ...report, issues });
});

// POST /api/shift-reports — create shift report
router.post('/', authenticateToken, requireRole('shift_responsible','administrator'), (req, res) => {
  const { shift_id, report_date, general_notes, issues } = req.body;
  if (!shift_id || !report_date) return res.status(400).json({ error: 'Schimbul și data sunt obligatorii' });

  const result = shiftReportsDb.prepare(`
    INSERT INTO shift_reports (shift_id, shift_responsible_id, report_date, general_notes)
    VALUES (?,?,?,?)
  `).run(shift_id, req.user.id, report_date, general_notes || '');

  const reportId = result.lastInsertRowid;

  if (issues && Array.isArray(issues)) {
    for (const issue of issues) {
      const { machine_id, order_id, description, delay_minutes } = issue;
      // Check if delay already logged by operator for this order
      let alreadyLogged = 0;
      if (order_id && delay_minutes > 0) {
        const { ordersDb } = require('../db/init');
        const existing = ordersDb.prepare("SELECT id FROM order_delays WHERE order_id = ? AND source = 'operator'").get(order_id);
        if (existing) alreadyLogged = 1;
      }

      shiftReportsDb.prepare(`
        INSERT INTO report_issues (report_id, machine_id, order_id, description, delay_minutes, delay_already_logged)
        VALUES (?,?,?,?,?,?)
      `).run(reportId, machine_id || null, order_id || null, description, delay_minutes || 0, alreadyLogged);
    }
  }

  res.status(201).json({ id: reportId, message: 'Raport de schimb creat cu succes' });
});

// PUT /api/shift-reports/:id — update report
router.put('/:id', authenticateToken, requireRole('shift_responsible','administrator'), (req, res) => {
  const { general_notes } = req.body;
  shiftReportsDb.prepare('UPDATE shift_reports SET general_notes=? WHERE id=?').run(general_notes, req.params.id);
  res.json({ message: 'Raport actualizat' });
});

// POST /api/shift-reports/:id/issues — add issue to existing report
router.post('/:id/issues', authenticateToken, requireRole('shift_responsible','administrator'), (req, res) => {
  const { machine_id, order_id, description, delay_minutes } = req.body;
  if (!description) return res.status(400).json({ error: 'Descrierea problemei este obligatorie' });

  let alreadyLogged = 0;
  if (order_id && delay_minutes > 0) {
    const { ordersDb } = require('../db/init');
    const existing = ordersDb.prepare("SELECT id FROM order_delays WHERE order_id = ? AND source = 'operator'").get(order_id);
    if (existing) alreadyLogged = 1;
  }

  const result = shiftReportsDb.prepare(`
    INSERT INTO report_issues (report_id, machine_id, order_id, description, delay_minutes, delay_already_logged)
    VALUES (?,?,?,?,?,?)
  `).run(req.params.id, machine_id || null, order_id || null, description, delay_minutes || 0, alreadyLogged);

  res.status(201).json({ id: result.lastInsertRowid, delay_already_logged: alreadyLogged });
});

module.exports = router;
