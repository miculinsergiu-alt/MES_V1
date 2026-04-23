const express = require('express');
const { db } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const OEEService = require('../services/oeeService');
const router = express.Router();

// GET /api/analytics/oee — get OEE metrics
router.get('/oee', authenticateToken, (req, res) => {
  const { date_from, date_to } = req.query;
  // Default to last 30 days if not provided
  const to = date_to || new Date().toISOString().substring(0, 10);
  const from = date_from || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().substring(0, 10);

  const stats = OEEService.getGlobalOEE(from, to);
  res.json(stats);
});

// GET /api/analytics/audit — get audit logs
router.get('/audit', authenticateToken, requireRole('administrator'), (req, res) => {
  const logs = db.prepare(`
    SELECT al.*, u.first_name, u.last_name, u.badge_number
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.timestamp DESC
    LIMIT 100
  `).all();
  res.json(logs);
});

module.exports = router;
