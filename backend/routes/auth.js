const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { unauthorized, badRequest } = require('../lib/errors');
const { authenticateToken, signToken } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

// Slow down password guessing: 10 attempts per minute per IP.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isTest ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a minute.', code: 'RATE_LIMITED' },
});

// Used to keep response time the same whether or not the user exists.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

const loginSchema = v.z.object({
  company_code: v.z.preprocess((x) => (x === '' ? undefined : x), v.z.string().trim().toUpperCase().max(32).optional()),
  badge_number: v.z.string().trim().toUpperCase().min(1).max(64),
  password: v.z.string().min(1).max(200),
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { company_code, badge_number, password } = v.body(req, loginSchema);

  const found = await db.withContext({ system: true }, async () => {
    let company;
    if (company_code) {
      company = await db.get('SELECT * FROM companies WHERE code = ? AND active = 1', [company_code]);
    } else {
      const companies = await db.all('SELECT * FROM companies WHERE active = 1 LIMIT 2');
      if (companies.length > 1) return { needsCompany: true };
      company = companies[0];
    }
    if (!company) return {};
    const user = await db.get(
      'SELECT * FROM users WHERE company_id = ? AND badge_number = ? AND active = 1',
      [company.id, badge_number],
    );
    return { company, user };
  });

  if (found.needsCompany) throw badRequest('Please enter your company code');

  const valid = await bcrypt.compare(password, found.user?.password_hash || DUMMY_HASH);
  if (!found.user || !valid) throw unauthorized('Wrong company code, badge number or password');

  const { user, company } = found;
  res.json({
    token: signToken(user, company),
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      badge_number: user.badge_number,
      role: user.role,
      company_id: company.id,
      company_code: company.code,
      company_name: company.name,
    },
  });
});

// GET /api/auth/me — current user, re-checked against the database
router.get('/me', authenticateToken, h(async (req, res) => {
  const user = await db.get(
    'SELECT id, first_name, last_name, badge_number, role FROM users WHERE id = ? AND active = 1',
    [req.user.id],
  );
  if (!user) throw unauthorized('User no longer active');
  const company = await db.get('SELECT id, code, name, timezone, locale, currency FROM companies WHERE id = ?', [req.user.company_id]);
  res.json({ ...user, company_id: company.id, company_code: company.code, company_name: company.name, company });
}));

module.exports = router;
