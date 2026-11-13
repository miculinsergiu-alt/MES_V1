const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let a; let b;
let aItem; let aMachine; let aSupplier;

before(async () => {
  await t.setup();
  a = await t.companyWithAdmin('ALPHA');
  b = await t.companyWithAdmin('BETA');
  aMachine = await t.createMachine(a.api, 'Alpha Press');
  aItem = await t.createItem(a.api, 'SECRET-1', 'raw_material', { acquisition_cost: 12.5 });
  aSupplier = (await a.api.post('/api/suppliers', { name: 'Alpha Supplier' })).body.id;
});
after(t.teardown);

test('lists only show the own company\'s records', async () => {
  for (const url of ['/api/items', '/api/machines', '/api/suppliers', '/api/users']) {
    const res = await b.api.get(url);
    assert.equal(res.status, 200, url);
    const names = JSON.stringify(res.body);
    assert.ok(!names.includes('SECRET-1') && !names.includes('Alpha'), `${url} leaked data: ${names}`);
  }
});

test('records of another company are "not found" by id', async () => {
  assert.equal((await b.api.get(`/api/items/${aItem}`)).status, 404);
  assert.equal((await b.api.get(`/api/machines/${aMachine}`)).status, 404);
});

test('records of another company cannot be changed', async () => {
  assert.equal((await b.api.put(`/api/items/${aItem}`, { name: 'hacked' })).status, 404);
  assert.equal((await b.api.put(`/api/suppliers/${aSupplier}`, { name: 'hacked' })).status, 404);
  assert.equal((await b.api.delete(`/api/machines/${aMachine}`)).status, 404);
  const item = await a.api.get(`/api/items/${aItem}`);
  assert.equal(item.body.name, 'SECRET-1');
});

test('records cannot reference another company\'s records', async () => {
  // Order on Alpha's machine, created by Beta
  const order = await b.api.post('/api/orders', {
    orders: [{ machine_id: aMachine, product_name: 'x', quantity: 1, planned_start: '2030-01-01 08:00' }],
  });
  assert.equal(order.status, 400);
  assert.equal(order.body.code, 'INVALID_REFERENCE');

  // Purchase order to Alpha's supplier for Alpha's item
  const po = await b.api.post('/api/procurement/purchase-orders', {
    supplier_id: aSupplier, items: [{ item_id: aItem, quantity_ordered: 5 }],
  });
  assert.equal(po.status, 400);

  // Stock adjustment of Alpha's item
  const adj = await b.api.post('/api/stock/adjust', { item_id: aItem, quantity: 999 });
  assert.equal(adj.status, 404);
  const stock = await a.api.get('/api/stock');
  assert.ok(!stock.body.some((s) => s.quantity === 999));
});

test('the same codes can be used by different companies', async () => {
  // Item codes, badge numbers and lot numbers are unique per company, not globally.
  await t.createItem(b.api, 'SECRET-1', 'raw_material');
  const user = await b.api.post('/api/users', { first_name: 'x', last_name: 'y', badge_number: 'ADMIN002', role: 'planner', password: t.PASSWORD });
  assert.equal(user.status, 201);
});

test('the same badge number in two companies logs into the right company', async () => {
  const resA = await t.request(t.app).post('/api/auth/login').send({ company_code: 'ALPHA', badge_number: 'ADMIN001', password: t.PASSWORD });
  const resB = await t.request(t.app).post('/api/auth/login').send({ company_code: 'BETA', badge_number: 'ADMIN001', password: t.PASSWORD });
  assert.notEqual(resA.body.user.company_id, resB.body.user.company_id);
});

test('database refuses to show rows when no company is selected', async () => {
  const rows = await t.db.withContext({}, () => t.db.all('SELECT * FROM items'));
  assert.equal(rows.length, 0);
});

test('audit log records who changed what, without passwords, per company', async () => {
  await a.api.post('/api/users', { first_name: 'Audit', last_name: 'Me', badge_number: 'AUD1', role: 'operator', password: 'super-secret-pw' });
  const logs = await t.db.withContext({ companyId: a.company.id }, () =>
    t.db.all("SELECT * FROM audit_logs WHERE entity = 'users' AND action = 'POST' ORDER BY id DESC LIMIT 1"));
  assert.equal(logs.length, 1);
  assert.ok(logs[0].user_id);
  assert.ok(!logs[0].new_data.includes('super-secret-pw'));
  assert.ok(logs[0].new_data.includes('[redacted]'));

  const bLogs = await t.db.withContext({ companyId: b.company.id }, () =>
    t.db.all("SELECT * FROM audit_logs WHERE new_data LIKE '%AUD1%'"));
  assert.equal(bLogs.length, 0);
});
