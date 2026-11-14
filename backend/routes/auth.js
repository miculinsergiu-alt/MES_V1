const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { unauthorized, badRequest, AppError } = require('../lib/errors');
const { authenticateToken, signToken, rolesOf } = require('../middleware/auth');
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

  res.json(sessionFor(found.user, found.company));
});

/** Token + user data the frontend keeps after login. */
function sessionFor(user, company) {
  return {
    token: signToken(user, company),
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      badge_number: user.badge_number,
      role: user.role,
      roles: rolesOf(user),
      company_id: company.id,
      company_code: company.code,
      company_name: company.name,
      onboarding_completed: company.onboarding_completed,
    },
  };
}

// ─── Self-service registration ──────────────────────────────────────────────

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isTest ? 1000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many registrations from this address. Please try again later.', code: 'RATE_LIMITED' },
});

// GET /api/auth/signup-config — whether registration is open
router.get('/signup-config', (req, res) => {
  res.json({ enabled: config.signupEnabled, invite_required: !!config.signupInviteCode });
});

/** Company code suggestion from the name: 'Müller Metallbau GmbH' -> 'MUELLERMETALL'. */
function codeFromName(name) {
  const base = name.toUpperCase()
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(GMBH|AG|KG|OHG|UG|GBR|MBH|CO|SE|EK|LTD|SRL|SA)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
  return (base || 'FIRMA').slice(0, 12);
}

const signupSchema = v.z.object({
  company_name: v.z.string().trim().min(2).max(200),
  company_code: v.z.preprocess((x) => (x === '' ? undefined : x), v.z.string().trim().toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, 'Company code: 2-32 letters, digits, - or _').optional()),
  first_name: v.str(100),
  last_name: v.str(100),
  email: v.z.string().trim().email().max(200),
  password: v.z.string().min(10, 'Password must be at least 10 characters').max(200),
  invite_code: v.z.string().max(100).optional(),
});

// POST /api/auth/signup — register a new company with its first administrator
router.post('/signup', signupLimiter, async (req, res) => {
  if (!config.signupEnabled) throw new AppError(403, 'SIGNUP_DISABLED', 'Registration is currently not open');
  const b = v.body(req, signupSchema);
  if (config.signupInviteCode && b.invite_code !== config.signupInviteCode) throw badRequest('Invalid invitation code');

  const passwordHash = await bcrypt.hash(b.password, 10);
  const { createCompanyInContext } = require('../scripts/companies');
  const result = await db.withContext({ system: true }, async () => {
    let code = b.company_code || codeFromName(b.company_name);
    const taken = async (c) => !!(await db.get('SELECT id FROM companies WHERE code = ?', [c]));
    if (await taken(code)) {
      if (b.company_code) throw new AppError(409, 'CODE_TAKEN', 'This company code is already taken. Please choose another one.');
      const base = code.slice(0, 10);
      for (let i = 2; await taken(code); i += 1) code = `${base}${i}`;
    }
    return createCompanyInContext({
      normalizedCode: code, name: b.company_name, timezone: 'Europe/Berlin', passwordHash,
      admin: { first_name: b.first_name, last_name: b.last_name, badge_number: 'ADMIN', email: b.email },
      onboardingCompleted: 0, signupEmail: b.email,
    });
  });
  const user = { id: result.admin.id, first_name: b.first_name, last_name: b.last_name, badge_number: result.admin.badge_number, role: 'administrator', roles: ['administrator'] };
  res.status(201).json(sessionFor(user, result.company));
});

// GET /api/auth/me — current user, re-checked against the database
router.get('/me', authenticateToken, h(async (req, res) => {
  const user = await db.get(
    'SELECT id, first_name, last_name, badge_number, role, roles FROM users WHERE id = ? AND active = 1',
    [req.user.id],
  );
  if (!user) throw unauthorized('User no longer active');
  const company = await db.get('SELECT id, code, name, timezone, locale, currency, onboarding_completed FROM companies WHERE id = ?', [req.user.company_id]);
  res.json({ ...user, company_id: company.id, company_code: company.code, company_name: company.name, onboarding_completed: company.onboarding_completed, company });
}));

module.exports = router;
module.exports.codeFromName = codeFromName;
