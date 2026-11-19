const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { unauthorized, badRequest, AppError } = require('../lib/errors');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { authenticateToken, signToken, rolesOf, COOKIE_NAME } = require('../middleware/auth');
const config = require('../config');
const totp = require('../lib/totp');
const { sendMail } = require('../lib/mailer');

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
  totp_code: v.z.string().trim().max(10).optional(),
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { company_code, badge_number, password, totp_code } = v.body(req, loginSchema);

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

  if (config.requireEmailVerification && found.user.email && !found.user.email_verified_at) {
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please confirm your e-mail address first (see the link we sent you).');
  }
  if (found.user.totp_enabled) {
    if (!totp_code) throw new AppError(401, 'TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app');
    if (!totp.verify(found.user.totp_secret, totp_code)) throw new AppError(401, 'TOTP_INVALID', 'Wrong authentication code');
  }

  sendSession(res, found.user, found.company);
});

/** Sets the httpOnly session cookie and returns the user data for the frontend. */
function sendSession(res, user, company, status = 200) {
  const session = sessionFor(user, company);
  const { exp } = jwt.decode(session.token);
  res.cookie(COOKIE_NAME, session.token, {
    httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/',
    maxAge: exp * 1000 - Date.now(),
  });
  res.status(status).json(session);
}

// POST /api/auth/logout — removes the session cookie
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' });
  res.status(204).end();
});

/** Token + user data after login. The browser uses the cookie; the token is for API clients. */
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
  const token = await db.withContext({ system: true }, () => createAuthToken(result.admin.id, result.company.id, 'email_verify', 48));
  await sendMail({
    to: b.email,
    subject: 'NOVA: Bitte E-Mail-Adresse bestätigen / Please confirm your e-mail',
    text: `Firmencode / company code: ${result.company.code}\nBenutzer / badge: ${result.admin.badge_number}\n\n`
      + `Bestätigen / confirm (48 h):\n${config.appUrl}/verify-email?token=${token}`,
  });
  if (config.requireEmailVerification) {
    return res.status(201).json({ verification_required: true, company_code: result.company.code, badge_number: result.admin.badge_number });
  }
  const user = { id: result.admin.id, first_name: b.first_name, last_name: b.last_name, badge_number: result.admin.badge_number, role: 'administrator', roles: ['administrator'], token_version: 0 };
  return sendSession(res, user, result.company, 201);
});

// ─── One-time e-mail links ──────────────────────────────────────────────────

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Creates a one-time token (only its hash is stored) and returns the raw token. */
async function createAuthToken(userId, companyId, purpose, hours) {
  const raw = crypto.randomBytes(32).toString('base64url');
  await db.run('UPDATE auth_tokens SET used_at = now() WHERE user_id = ? AND purpose = ? AND used_at IS NULL', [userId, purpose]);
  await db.run(
    `INSERT INTO auth_tokens (company_id, user_id, purpose, token_hash, expires_at) VALUES (?,?,?,?, now() + (? || ' hours')::interval)`,
    [companyId, userId, purpose, sha256(raw), String(hours)],
  );
  return raw;
}

/** Marks a valid token as used and returns its row, or throws. */
async function consumeAuthToken(raw, purpose) {
  const row = await db.get(
    'SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > now()',
    [sha256(String(raw || '')), purpose],
  );
  if (!row) throw new AppError(400, 'TOKEN_INVALID', 'This link is invalid or has expired');
  await db.run('UPDATE auth_tokens SET used_at = now() WHERE id = ?', [row.id]);
  return row;
}

const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' },
});

// POST /api/auth/verify-email { token }
router.post('/verify-email', tokenLimiter, async (req, res) => {
  const { token } = v.body(req, v.z.object({ token: v.z.string().min(10).max(200) }));
  await db.withContext({ system: true }, async () => {
    const row = await consumeAuthToken(token, 'email_verify');
    await db.run('UPDATE users SET email_verified_at = nova_now() WHERE id = ?', [row.user_id]);
  });
  res.json({ ok: true });
});

// POST /api/auth/forgot-password { company_code, email }
// Always answers the same way, so it does not reveal which addresses exist.
router.post('/forgot-password', tokenLimiter, async (req, res) => {
  const b = v.body(req, v.z.object({
    company_code: v.z.string().trim().toUpperCase().min(1).max(32),
    email: v.z.string().trim().email().max(200),
  }));
  await db.withContext({ system: true }, async () => {
    const user = await db.get(
      `SELECT u.id, u.company_id, u.badge_number, c.code FROM users u JOIN companies c ON c.id = u.company_id
       WHERE c.code = ? AND c.active = 1 AND u.active = 1 AND lower(u.email) = lower(?)`,
      [b.company_code, b.email],
    );
    if (!user) return;
    const token = await createAuthToken(user.id, user.company_id, 'password_reset', 1);
    await sendMail({
      to: b.email,
      subject: 'NOVA: Passwort zurücksetzen / Reset your password',
      text: `Firmencode / company code: ${user.code}\nBenutzer / badge: ${user.badge_number}\n\n`
        + `Neues Passwort festlegen / set a new password (1 h):\n${config.appUrl}/reset-password?token=${token}\n\n`
        + 'Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail. / If you did not ask for this, ignore this e-mail.',
    });
  });
  res.json({ ok: true });
});

// POST /api/auth/reset-password { token, password }
router.post('/reset-password', tokenLimiter, async (req, res) => {
  const b = v.body(req, v.z.object({
    token: v.z.string().min(10).max(200),
    password: v.z.string().min(10, 'Password must be at least 10 characters').max(200),
  }));
  const hash = await bcrypt.hash(b.password, 10);
  await db.withContext({ system: true }, async () => {
    const row = await consumeAuthToken(b.token, 'password_reset');
    // Following the link proves the e-mail address, too. Older sessions end.
    await db.run(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1, email_verified_at = COALESCE(email_verified_at, nova_now()) WHERE id = ?',
      [hash, row.user_id],
    );
  });
  res.json({ ok: true });
});

// ─── Own account: password and two-factor login ─────────────────────────────

const ownUser = (id) => db.get('SELECT * FROM users WHERE id = ?', [id]);

async function checkPassword(user, password) {
  if (!(await bcrypt.compare(String(password || ''), user.password_hash))) throw badRequest('Current password is wrong');
}

// POST /api/auth/change-password { current_password, new_password }
router.post('/change-password', authenticateToken, h(async (req, res) => {
  const b = v.body(req, v.z.object({
    current_password: v.z.string().min(1).max(200),
    new_password: v.z.string().min(10, 'Password must be at least 10 characters').max(200),
  }));
  const user = await ownUser(req.user.id);
  await checkPassword(user, b.current_password);
  await db.run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [await bcrypt.hash(b.new_password, 10), user.id]);
  const company = await db.get('SELECT * FROM companies WHERE id = ?', [req.user.company_id]);
  sendSession(res, { ...user, token_version: user.token_version + 1 }, company);
}));

// POST /api/auth/2fa/setup — new secret (not active until confirmed with a code)
router.post('/2fa/setup', authenticateToken, h(async (req, res) => {
  const user = await ownUser(req.user.id);
  if (user.totp_enabled) throw badRequest('Two-factor login is already on');
  const secret = totp.generateSecret();
  await db.run('UPDATE users SET totp_secret = ? WHERE id = ?', [secret, user.id]);
  res.json({ secret, otpauth_url: totp.otpauthUrl(secret, `${req.user.company_code}/${user.badge_number}`) });
}));

// POST /api/auth/2fa/enable { code }
router.post('/2fa/enable', authenticateToken, h(async (req, res) => {
  const { code } = v.body(req, v.z.object({ code: v.z.string().trim().max(10) }));
  const user = await ownUser(req.user.id);
  if (!user.totp_secret || !totp.verify(user.totp_secret, code)) throw new AppError(400, 'TOTP_INVALID', 'Wrong authentication code');
  await db.run('UPDATE users SET totp_enabled = 1 WHERE id = ?', [user.id]);
  res.json({ ok: true, totp_enabled: true });
}));

// POST /api/auth/2fa/disable { password }
router.post('/2fa/disable', authenticateToken, h(async (req, res) => {
  const { password } = v.body(req, v.z.object({ password: v.z.string().min(1).max(200) }));
  const user = await ownUser(req.user.id);
  await checkPassword(user, password);
  await db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [user.id]);
  res.json({ ok: true, totp_enabled: false });
}));

// GET /api/auth/me — current user, re-checked against the database
router.get('/me', authenticateToken, h(async (req, res) => {
  const user = await db.get(
    'SELECT id, first_name, last_name, badge_number, email, role, roles, totp_enabled FROM users WHERE id = ? AND active = 1',
    [req.user.id],
  );
  if (!user) throw unauthorized('User no longer active');
  const company = await db.get('SELECT id, code, name, timezone, locale, currency, onboarding_completed FROM companies WHERE id = ?', [req.user.company_id]);
  res.json({ ...user, company_id: company.id, company_code: company.code, company_name: company.name, onboarding_completed: company.onboarding_completed, company });
}));

module.exports = router;
module.exports.codeFromName = codeFromName;
