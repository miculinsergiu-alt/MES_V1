const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');
const { ensureDemoData } = require('../scripts/seed-demo');

let api;
before(async () => {
  await t.setup();
  assert.equal(await ensureDemoData(t.app), true);
});
after(t.teardown);

test('demo data is created once', async () => {
  assert.equal(await ensureDemoData(t.app), false);
});

test('one-click demo login without company code or password', async () => {
  const res = await t.request(t.app).post('/api/auth/demo').send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.company_code, 'DEMO');
  assert.ok(res.headers['set-cookie']);
  api = t.client(res.body.token);

  const op = await t.request(t.app).post('/api/auth/demo').send({ badge_number: 'OPR001' });
  assert.deepEqual(op.body.user.roles, ['operator']);
  assert.equal((await t.request(t.app).post('/api/auth/demo').send({ badge_number: 'NOPE' })).status, 400);
});

test('the demo company looks like a working business', async () => {
  assert.equal((await api.get('/api/customers')).body.length, 5);
  const docs = (await api.get('/api/sales')).body;
  const invoices = docs.filter((d) => d.doc_type === 'invoice' && d.number);
  assert.equal(invoices.length, 4);
  assert.ok(docs.some((d) => d.doc_type === 'quote' && d.status === 'declined'));
  assert.ok(invoices.some((d) => d.status === 'paid'), JSON.stringify(invoices.map((d) => d.status)));
  const orders = (await api.get('/api/orders')).body;
  assert.ok(orders.some((o) => o.status === 'done'));
  assert.ok(orders.some((o) => o.status !== 'done'));
  assert.ok((await api.get('/api/stock')).body.length > 5);
});

test('demo visitors cannot lock others out', async () => {
  assert.equal((await api.post('/api/auth/change-password', { current_password: 'demo1234', new_password: 'xxxxxxxx1' })).status, 403);
  assert.equal((await api.post('/api/auth/2fa/setup')).status, 403);
  assert.equal((await api.post('/api/users', { first_name: 'a', last_name: 'b', badge_number: 'X1', role: 'operator', password: 'abcdefgh1' })).status, 403);
  assert.equal((await api.get('/api/users')).status, 200);
});
