const jwt = require('jsonwebtoken');
const config = require('../config');
const { unauthorized, forbidden } = require('../lib/errors');

const ROLES = ['administrator', 'planner', 'area_supervisor', 'shift_responsible', 'operator', 'warehouse_manager', 'material_planner', 'sales', 'accounting'];

function signToken(user, company) {
  return jwt.sign(
    {
      id: user.id,
      company_id: company.id,
      company_code: company.code,
      timezone: company.timezone,
      badge_number: user.badge_number,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
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

/** Requires a valid Bearer token; sets req.user (incl. company_id). */
function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized('Missing token'));
  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };
}

module.exports = { authenticateToken, requireRole, signToken, verifyToken, ROLES };
