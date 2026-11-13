const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let operator; let sales;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('DASH');
  operator = await t.userClient(c.api, 'DASH', 'OP1', 'operator');
  sales = await t.userClient(c.api, 'DASH', 'VK1', 'sales');
  await t.createItem(c.api, 'FLANSCH-80', 'finished_good', { unit_price: 10 });
  await c.api.post('/api/customers', { name: 'Flanschwerk Süd GmbH', street: 'Weg 1', postal_code: '80331', city: 'München' }).expect(201);
  await c.api.post('/api/suppliers', { name: 'Flansch-Lieferant KG' }).expect(200);
});
after(t.teardown);

test('admin sees all dashboard sections including the setup checklist', async () => {
  const res = await c.api.get('/api/dashboard');
  assert.equal(res.status, 200);
  for (const k of ['production', 'maintenance', 'inventory', 'sales', 'incoming', 'setup']) assert.ok(res.body[k], k);
  assert.equal(res.body.setup.has_items, true);
  assert.equal(res.body.setup.company_data_complete, false);
  assert.equal(res.body.sales.open_amount, 0);
});

test('roles see only their sections', async () => {
  const op = (await operator.api.get('/api/dashboard')).body;
  assert.deepEqual(Object.keys(op), []);
  const s = (await sales.api.get('/api/dashboard')).body;
  assert.deepEqual(Object.keys(s).sort(), ['sales']);
});

test('search finds items, customers and suppliers for the admin', async () => {
  const res = await c.api.get('/api/search?q=flansch');
  assert.equal(res.status, 200);
  assert.deepEqual([...new Set(res.body.map((r) => r.type))].sort(), ['customer', 'item', 'supplier']);
  assert.ok(res.body.every((r) => r.path.startsWith('/')));
});

test('search respects roles and requires two characters', async () => {
  const res = await sales.api.get('/api/search?q=flansch');
  assert.deepEqual([...new Set(res.body.map((r) => r.type))], ['customer']);
  assert.deepEqual((await operator.api.get('/api/search?q=flansch')).body, []);
  assert.equal((await c.api.get('/api/search?q=f')).status, 400);
});

test('search never shows other companies\' data', async () => {
  const other = await t.companyWithAdmin('DASH2');
  assert.deepEqual((await other.api.get('/api/search?q=flansch')).body, []);
});
