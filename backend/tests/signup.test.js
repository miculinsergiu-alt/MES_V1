/**
 * Self-service registration and setup wizard support.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');
const config = require('../config');

const signup = (body) => t.request(t.app).post('/api/auth/signup').send({
  company_name: 'Müller Metallbau GmbH', first_name: 'Max', last_name: 'Müller', email: 'max@mueller-metall.de', password: 'sicheres-passwort-1', ...body,
});

before(t.setup);
after(t.teardown);

test('registration creates the company, logs the admin in and starts the wizard', async () => {
  const res = await signup({});
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.user.company_code, 'MUELLERMETAL');
  assert.equal(res.body.user.badge_number, 'ADMIN');
  assert.equal(res.body.user.role, 'administrator');
  assert.equal(res.body.user.onboarding_completed, 0);
  const api = t.client(res.body.token);
  assert.equal((await api.get('/api/auth/me')).body.onboarding_completed, 0);
  // Can log in again with the shown company code
  await t.request(t.app).post('/api/auth/login').send({ company_code: 'muellermetal', badge_number: 'admin', password: 'sicheres-passwort-1' }).expect(200);
});

test('a second company with the same name gets a free code; a taken explicit code is refused', async () => {
  const res = await signup({ email: 'b@b.de' });
  assert.equal(res.body.user.company_code, 'MUELLERMET2'); // shortened base + counter
  assert.equal((await signup({ company_code: 'MUELLERMETAL' })).status, 409);
});

test('weak passwords and invalid e-mails are refused', async () => {
  assert.equal((await signup({ company_name: 'X GmbH', password: 'kurz' })).status, 400);
  assert.equal((await signup({ company_name: 'Y GmbH', email: 'keine-mail' })).status, 400);
});

test('registration can be closed or require an invitation code', async () => {
  const saved = { ...config };
  try {
    config.signupEnabled = false;
    assert.equal((await signup({ company_name: 'Zu GmbH' })).status, 403);
    assert.deepEqual((await t.request(t.app).get('/api/auth/signup-config')).body, { enabled: false, invite_required: false, demo: config.demoLogin });
    config.signupEnabled = true;
    config.signupInviteCode = 'BETA-2026';
    assert.equal((await signup({ company_name: 'Beta GmbH' })).status, 400);
    assert.equal((await signup({ company_name: 'Beta GmbH', invite_code: 'BETA-2026' })).status, 201);
  } finally {
    config.signupEnabled = saved.signupEnabled;
    config.signupInviteCode = saved.signupInviteCode;
  }
});

test('sample data loads into an empty company only, and the wizard can be completed', async () => {
  const res = await signup({ company_name: 'Probe Fertigung GmbH', email: 'p@probe.de' });
  const api = t.client(res.body.token);
  const load = await api.post('/api/setup/sample-data');
  assert.equal(load.status, 201, JSON.stringify(load.body));
  assert.equal((await api.get('/api/items')).body.length, 4);
  assert.equal((await api.get('/api/machines')).body.length, 3);
  assert.equal((await api.post('/api/setup/sample-data')).status, 409);

  // The sample data is usable right away: order with routing and BOM -> MRP
  const holder = (await api.get('/api/items')).body.find((i) => i.item_code === 'HALT-200');
  const bomId = (await api.get(`/api/boms/by-item/${holder.id}`)).body.id;
  const order = await api.post('/api/orders', { orders: [{ item_id: holder.id, bom_id: bomId, quantity: 10, planned_start: '2030-01-07 07:00' }] });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  // A new customer continues after the sample customer number
  const cust = await api.post('/api/customers', { name: 'Neu GmbH' });
  assert.equal(cust.body.customer_number, '10002');

  await api.post('/api/setup/complete').expect(200);
  assert.equal((await api.get('/api/auth/me')).body.onboarding_completed, 1);
});

test('only administrators may use the setup endpoints', async () => {
  const c = await t.companyWithAdmin('SETUPROLE');
  const planner = await t.userClient(c.api, 'SETUPROLE', 'P1', 'planner');
  assert.equal((await planner.api.post('/api/setup/sample-data')).status, 403);
});
