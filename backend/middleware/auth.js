const jwt = require('jsonwebtoken');
const config = require('../config');
const { unauthorized, forbidden } = require('../lib/errors');

const ROLES = ['administrator', 'planner', 'area_supervisor', 'shift_responsible', 'operator', 'warehouse_manager', 'material_planner', 'sales', 'accounting'];

/** All roles of a user (tokens from before multi-role support only carry "role"). */
function rolesOf(user) {
  return Array.isArray(user?.roles) && user.roles.length ? user.roles : (user?.role ? [user.role] : []);
}

/** True if the user has at least one of the roles. */
function hasRole(user, ...roles) {
  return rolesOf(user).some((r) => roles.includes(r));
}

/** Shop-floor users who are only operators may only act on their own tasks. */
function isOnlyOperator(user) {
  const r = rolesOf(user);
  return r.length > 0 && r.every((x) => x === 'operator');
}

const COOKIE_NAME = 'nova_session';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function signToken(user, company) {
  return jwt.sign(
    {
      id: user.id,
      company_id: company.id,
      company_code: company.code,
      timezone: company.timezone,
      badge_number: user.badge_number,
      role: user.role,
      roles: rolesOf(user),
      first_name: user.first_name,
      last_name: user.last_name,
      tv: user.token_version || 0,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

function verifyToken(token) {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (!decoded.company_id || !decoded.id) throw new Error('Token without company');
  return decoded;
}

/**
 * Requires a valid Bearer token; sets req.user (incl. company_id).
 * Roles and the active flag are read from the database on every request, so
 * role changes and deactivations take effect at once, without a new login.
 */
async function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || req.cookies?.[COOKIE_NAME] || null;
  if (!token) return next(unauthorized('Missing token'));
  // Cookie sessions: state-changing requests must carry the custom header that
  // only our own frontend sends (protection against cross-site request forgery).
  if (!bearer && !SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'NOVA') {
    return next(forbidden('Missing request header'));
  }
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }
  try {
    const db = require('../db');
    const current = await db.withContext({ companyId: decoded.company_id, userId: decoded.id, timezone: decoded.timezone },
      () => db.get('SELECT role, roles, token_version FROM users WHERE id = ? AND active = 1', [decoded.id]));
    if (!current) return next(unauthorized('User no longer active'));
    // A password change, reset or "log out everywhere" invalidates older tokens.
    if ((decoded.tv || 0) !== (current.token_version || 0)) return next(unauthorized('Session expired, please log in again'));
    req.user = { ...decoded, role: current.role, roles: rolesOf(current) };
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!hasRole(req.user, ...roles)) return next(forbidden());
    return next();
  };
}

/** Public demo company: visitors may not lock others out (passwords, 2FA, users). */
function blockInDemo(req, res, next) {
  if (req.method !== 'GET' && req.user?.company_code === 'DEMO') {
    return res.status(403).json({ error: 'Not possible in the demo', code: 'DEMO_READ_ONLY' });
  }
  return next();
}

module.exports = {
  blockInDemo, COOKIE_NAME, authenticateToken, requireRole, signToken, verifyToken, rolesOf, hasRole, isOnlyOperator, ROLES };
