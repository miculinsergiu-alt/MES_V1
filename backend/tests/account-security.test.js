/**
 * Account security: session cookie + CSRF header, password reset, e-mail
 * verification, change password, two-factor login, security headers.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');
const config = require('../config');
const totp = require('../lib/totp');
const { outbox } = require('../lib/mailer');

const PW = 'sicheres-passwort-1';
let code;

const linkToken = (mail) => mail.text.match(/token=([A-Za-z0-9_-]+)/)[1];
const lastMailTo = (to) => [...outbox].reverse().find((m) => m.to === to);
const login = (body) => t.request(t.app).post('/api/auth/login').send({ company_code: code, badge_number: 'ADMIN', password: PW, ...body });

before(async () => {
  await t.setup();
  const res = await t.request(t.app).post('/api/auth/signup').send({
    company_name: 'Sicher Fertigung GmbH', first_name: 'Eva', last_name: 'Sicher', email: 'eva@sicher.de', password: PW,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  code = res.body.user.company_code;
});
after(t.teardown);

test('TOTP codes follow RFC 6238', () => {
  // RFC 6238 test vector (SHA-1, secret "12345678901234567890", T=59 s -> 94287082, last 6 digits)
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp.generate(secret, 59_000), '287082');
  assert.ok(totp.verify(secret, '287082', 59_000));
  assert.ok(!totp.verify(secret, '287083', 59_000));
});

test('login sets an httpOnly SameSite=Strict cookie; cookie sessions need the CSRF header for changes', async () => {
  const res = await login({}).expect(200);
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith('nova_session='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const jar = cookie.split(';')[0];
  await t.request(t.app).get('/api/auth/me').set('Cookie', jar).expect(200);
  await t.request(t.app).post('/api/customers').set('Cookie', jar).send({ name: 'X' }).expect(403);
  const ok = await t.request(t.app).post('/api/customers').set('Cookie', jar).set('X-Requested-With', 'NOVA').send({ name: 'Kunde A' });
  assert.notEqual(ok.status, 403);
  const out = await t.request(t.app).post('/api/auth/logout').expect(204);
  assert.match(out.headers['set-cookie'][0], /nova_session=;/);
});

test('signup sends a verification link that confirms the address', async () => {
  const mail = lastMailTo('eva@sicher.de');
  assert.match(mail.subject, /bestätigen/);
  await t.request(t.app).post('/api/auth/verify-email').send({ token: linkToken(mail) }).expect(200);
  await t.request(t.app).post('/api/auth/verify-email').send({ token: linkToken(mail) }).expect(400); // one-time
});

test('with verification required, unverified registrations cannot log in', async () => {
  config.requireEmailVerification = true;
  try {
    const res = await t.request(t.app).post('/api/auth/signup').send({
      company_name: 'Neu Dreh GmbH', first_name: 'A', last_name: 'B', email: 'neu@dreh.de', password: PW,
    }).expect(201);
    assert.equal(res.body.verification_required, true);
    assert.equal(res.body.token, undefined);
    const tryLogin = () => t.request(t.app).post('/api/auth/login').send({ company_code: res.body.company_code, badge_number: 'ADMIN', password: PW });
    assert.equal((await tryLogin()).body.code, 'EMAIL_NOT_VERIFIED');
    await t.request(t.app).post('/api/auth/verify-email').send({ token: linkToken(lastMailTo('neu@dreh.de')) }).expect(200);
    await tryLogin().expect(200);
  } finally {
    config.requireEmailVerification = false;
  }
});

test('password reset: same answer for unknown addresses, one-time link, old sessions end', async () => {
  const oldToken = (await login({}).expect(200)).body.token;
  const before = outbox.length;
  await t.request(t.app).post('/api/auth/forgot-password').send({ company_code: code, email: 'nobody@sicher.de' }).expect(200);
  assert.equal(outbox.length, before);
  await t.request(t.app).post('/api/auth/forgot-password').send({ company_code: code, email: 'EVA@sicher.de' }).expect(200);
  const token = linkToken(lastMailTo('EVA@sicher.de'));
  await t.request(t.app).post('/api/auth/reset-password').send({ token, password: 'kurz' }).expect(400);
  await t.request(t.app).post('/api/auth/reset-password').send({ token, password: 'neues-passwort-22' }).expect(200);
  await t.request(t.app).post('/api/auth/reset-password').send({ token, password: 'noch-ein-passwort-3' }).expect(400);
  await t.client(oldToken).get('/api/auth/me').expect(401);
  await login({ password: 'neues-passwort-22' }).expect(200);
  // back to the shared password for the next tests
  const api = t.client((await login({ password: 'neues-passwort-22' })).body.token);
  await api.post('/api/auth/change-password', { current_password: 'falsch', new_password: PW }).expect(400);
  await api.post('/api/auth/change-password', { current_password: 'neues-passwort-22', new_password: PW }).expect(200);
  await api.get('/api/auth/me').expect(401); // the change ended this session too
});

test('two-factor login: setup, enable with a code, login needs the code, disable with password', async () => {
  const api = t.client((await login({}).expect(200)).body.token);
  const { secret, otpauth_url } = (await api.post('/api/auth/2fa/setup').expect(200)).body;
  assert.match(otpauth_url, /^otpauth:\/\/totp\//);
  await api.post('/api/auth/2fa/enable', { code: '000000' }).expect(400);
  await api.post('/api/auth/2fa/enable', { code: totp.generate(secret) }).expect(200);
  assert.equal((await api.get('/api/auth/me')).body.totp_enabled, 1);

  assert.equal((await login({})).body.code, 'TOTP_REQUIRED');
  assert.equal((await login({ totp_code: '123456' })).body.code, 'TOTP_INVALID');
  await login({ totp_code: totp.generate(secret) }).expect(200);

  await api.post('/api/auth/2fa/disable', { password: 'falsch' }).expect(400);
  await api.post('/api/auth/2fa/disable', { password: PW }).expect(200);
  await login({}).expect(200);
});

test('responses carry a content security policy', async () => {
  const res = await t.request(t.app).get('/api/health');
  assert.match(res.headers['content-security-policy'], /script-src 'self'/);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
});
