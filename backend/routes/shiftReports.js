const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { formatLocal, parseLocal } = require('../lib/time');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

/** Time window of a shift on a given date (night shifts end the next day). */
function shiftWindow(reportDate, shift) {
  const start = `${reportDate} ${shift.start_time || '00:00'}:00`;
  let end = `${reportDate} ${shift.end_time || '23:59'}:00`;
  if (shift.end_time && shift.start_time && shift.end_time < shift.start_time) {
    end = formatLocal(parseLocal(end) + 24 * 3600 * 1000);
  }
  return { start, end };
}

async function operatorDelayAlreadyLogged(orderId, delayMinutes) {
  if (!orderId || !(delayMinutes > 0)) return 0;
  const existing = await db.get("SELECT id FROM order_delays WHERE order_id = ? AND source = 'operator' LIMIT 1", [orderId]);
  return existing ? 1 : 0;
}

// GET /api/shift-reports — reports, including delays operators logged during the shift
router.get('/', requireRole('area_supervisor', 'shift_responsible', 'administrator'), h(async (req, res) => {
  const q = v.query(req, v.z.object({ shift_id: v.optId, date_from: v.optDate, date_to: v.optDate }));
  const params = [];
  let sql = 'SELECT * FROM shift_reports WHERE 1=1';
  if (q.shift_id) { sql += ' AND shift_id = ?'; params.push(q.shift_id); }
  if (q.date_from) { sql += ' AND report_date >= ?'; params.push(q.date_from); }
  if (q.date_to) { sql += ' AND report_date <= ?'; params.push(q.date_to); }
  const reports = await db.all(`${sql} ORDER BY report_date DESC, created_at DESC LIMIT 500`, params);

  const shifts = new Map((await db.all('SELECT * FROM shifts')).map((s) => [s.id, s]));
  const result = [];
  for (const r of reports) {
    const issues = await db.all('SELECT * FROM report_issues WHERE report_id = ? ORDER BY id', [r.id]);
    const shift = shifts.get(r.shift_id);
    if (shift) {
      const { start, end } = shiftWindow(r.report_date, shift);
      const operatorDelays = await db.all(`
        SELECT od.*, o.product_name, o.machine_id
        FROM order_delays od JOIN orders o ON od.order_id = o.id
        WHERE od.source = 'operator' AND od.created_at BETWEEN ? AND ?`, [start, end]);
      for (const od of operatorDelays) {
        const exists = issues.some((iss) => iss.order_id === od.order_id && iss.delay_minutes === od.delay_minutes);
        if (!exists) {
          issues.push({
            id: `auto-${od.id}`,
            report_id: r.id,
            machine_id: od.machine_id,
            order_id: od.order_id,
            description: `[AUTO-OPERATOR] ${od.reason || ''}`.trim(),
            delay_minutes: od.delay_minutes,
            delay_already_logged: 1,
            is_auto: true,
          });
        }
      }
    }
    result.push({ ...r, issues });
  }
  res.json(result);
}));

// GET /api/shift-reports/:id
router.get('/:id', requireRole('area_supervisor', 'shift_responsible', 'administrator'), h(async (req, res) => {
  const report = await db.get('SELECT * FROM shift_reports WHERE id = ?', [v.paramId(req)]);
  if (!report) throw notFound('Shift report');
  const issues = await db.all('SELECT * FROM report_issues WHERE report_id = ? ORDER BY id', [report.id]);
  res.json({ ...report, issues });
}));

const issueSchema = v.z.object({
  machine_id: v.optId,
  order_id: v.optId,
  description: v.str(5000),
  delay_minutes: v.z.coerce.number().int().min(0).default(0),
});

// POST /api/shift-reports — create a shift report with issues
router.post('/', requireRole('shift_responsible', 'administrator'), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    shift_id: v.id,
    report_date: v.date,
    general_notes: v.optStr(10000),
    issues: v.z.array(issueSchema).optional(),
  }));
  const report = await db.get(`
    INSERT INTO shift_reports (shift_id, shift_responsible_id, report_date, general_notes)
    VALUES (?, ?, ?, ?) RETURNING id`, [b.shift_id, req.user.id, b.report_date, b.general_notes ?? '']);
  for (const issue of b.issues || []) {
    const logged = await operatorDelayAlreadyLogged(issue.order_id, issue.delay_minutes);
    await db.run(`
      INSERT INTO report_issues (report_id, machine_id, order_id, description, delay_minutes, delay_already_logged)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [report.id, issue.machine_id ?? null, issue.order_id ?? null, issue.description, issue.delay_minutes, logged]);
  }
  res.status(201).json({ id: report.id, message: 'Shift report created' });
}));

// PUT /api/shift-reports/:id — update notes
router.put('/:id', requireRole('shift_responsible', 'administrator'), h(async (req, res) => {
  const b = v.body(req, v.z.object({ general_notes: v.optStr(10000) }));
  const r = await db.run('UPDATE shift_reports SET general_notes = ? WHERE id = ?', [b.general_notes ?? '', v.paramId(req)]);
  if (!r.rowCount) throw notFound('Shift report');
  res.json({ message: 'Shift report updated' });
}));

// POST /api/shift-reports/:id/issues — add an issue to a report
router.post('/:id/issues', requireRole('shift_responsible', 'administrator'), h(async (req, res) => {
  const reportId = v.paramId(req);
  const b = v.body(req, issueSchema);
  if (!(await db.get('SELECT id FROM shift_reports WHERE id = ?', [reportId]))) throw notFound('Shift report');
  const logged = await operatorDelayAlreadyLogged(b.order_id, b.delay_minutes);
  const row = await db.get(`
    INSERT INTO report_issues (report_id, machine_id, order_id, description, delay_minutes, delay_already_logged)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  [reportId, b.machine_id ?? null, b.order_id ?? null, b.description, b.delay_minutes, logged]);
  res.status(201).json({ id: row.id, delay_already_logged: logged });
}));

module.exports = router;
