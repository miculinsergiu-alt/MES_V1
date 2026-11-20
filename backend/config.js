/**
 * Central configuration. Fails fast on unsafe production settings.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';
const isTest = env === 'test';

function resolveJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) {
    if (isProduction && fromEnv.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production.');
    }
    return fromEnv;
  }
  if (isProduction) throw new Error('JWT_SECRET must be set in production.');
  if (isTest) return 'test-secret-not-for-production-use-0123456789';
  // Development: generate once and keep it, so restarts don't log everyone out.
  const file = path.join(__dirname, 'data', 'dev-jwt-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

module.exports = {
  env,
  isProduction,
  isTest,
  port: Number(process.env.PORT || 3001),
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  // Comma-separated list of allowed browser origins for cross-origin calls.
  // Not needed when the frontend is served by this server (production) or via the Vite proxy (development).
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Self-service company registration. Off in production unless SIGNUP_ENABLED=true.
  signupEnabled: process.env.SIGNUP_ENABLED ? process.env.SIGNUP_ENABLED === 'true' : !isProduction,
  // Optional: registration only with this invitation code (e.g. for a closed beta).
  signupInviteCode: process.env.SIGNUP_INVITE_CODE || null,
  // Public address of the app, used in links sent by e-mail (password reset, verification).
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // Outgoing e-mail. Without SMTP_HOST, messages are only written to the log.
  smtp: {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
    from: process.env.SMTP_FROM || 'NOVA <no-reply@localhost>',
  },
  // New registrations must confirm their e-mail before logging in. On by default
  // once SMTP is configured (without SMTP nobody could receive the link).
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION
    ? process.env.REQUIRE_EMAIL_VERIFICATION === 'true'
    : !!process.env.SMTP_HOST,
  // One-click demo login (company DEMO with sample data, public password). Off in production unless DEMO_LOGIN=true.
  demoLogin: process.env.DEMO_LOGIN ? process.env.DEMO_LOGIN === 'true' : !isProduction,
  // Cookie flag: Secure in production (HTTPS only).
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction,
  trustProxy:process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : (isProduction ? 1 : false),
};
