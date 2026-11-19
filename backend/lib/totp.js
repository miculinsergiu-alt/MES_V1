/**
 * Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 s) for
 * two-factor login. Compatible with Google Authenticator, Authy, 1Password etc.
 */
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeAt(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const num = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(num).padStart(6, '0');
}

/** Current code (used by tests). */
function generate(secret, now = Date.now()) {
  return codeAt(secret, Math.floor(now / 30000));
}

/** Accepts the current code and one step before/after (clock drift). */
function verify(secret, code, now = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return false;
  const step = Math.floor(now / 30000);
  for (let d = -1; d <= 1; d += 1) {
    const expected = codeAt(secret, step + d);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return true;
  }
  return false;
}

/** otpauth:// link for authenticator apps (shown as QR code in the UI). */
function otpauthUrl(secret, account, issuer = 'NOVA') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { generateSecret, generate, verify, otpauthUrl, base32Encode, base32Decode };
