const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

before(t.setup);
after(t.teardown);

describe('login', () => {
  let acme;
  before(async () => { acme = await t.companyWithAdmin('ACME'); });

  test('valid credentials return a token with the company', async () => {
    const res = await t.request(t.app).post('/api/auth/login')
      .send({ company_code: 'acme', badge_number: 'admin001', password: t.PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.company_code, 'ACME');
    assert.equal(res.body.user.role, 'administrator');
    assert.equal(res.body.user.password_hash, undefined);
  });

  test('wrong password, unknown badge and unknown company are rejected the same way', async () => {
    for (const body of [
      { company_code: 'ACME', badge_number: 'ADMIN001', password: 'wrong-password' },
      { company_code: 'ACME', badge_number: 'NOBODY', password: t.PASSWORD },
      { company_code: 'NOPE', badge_number: 'ADMIN001', password: t.PASSWORD },
    ]) {
      const res = await t.request(t.app).post('/api/auth/login').send(body);
      assert.equal(res.status, 401, JSON.stringify(body));
      assert.equal(res.body.code, 'UNAUTHORIZED');
    }
  });

  test('company code is required once more than one company exists', async () => {
    await t.companyWithAdmin('OTHER');
    const res = await t.request(t.app).post('/api/auth/login').send({ badge_number: 'ADMIN001', password: t.PASSWORD });
    assert.equal(res.status, 400);
  });

  test('deactivated users cannot log in', async () => {
    const { id } = await t.userClient(acme.api, 'ACME', 'GONE01', 'operator');
    await acme.api.delete(`/api/users/${id}`).expect(200);
    const res = await t.request(t.app).post('/api/auth/login').send({ company_code: 'ACME', badge_number: 'GONE01', password: t.PASSWORD });
    assert.equal(res.status, 401);
  });

  test('/me returns the current user and company', async () => {
    const res = await acme.api.get('/api/auth/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.company.code, 'ACME');
    assert.equal(res.body.company.timezone, 'Europe/Berlin');
  });
});

describe('every API route requires login', () => {
  // These routes were previously reachable without logging in.
  const routes = [
    ['get', '/api/suppliers'],
    ['post', '/api/suppliers'],
    ['get', '/api/warehousing/warehouses'],
    ['post', '/api/warehousing/warehouses'],
    ['get', '/api/quality/quarantine'],
    ['put', '/api/quality/quarantine/1/resolve'],
    ['get', '/api/procurement/purchase-orders'],
    ['get', '/api/inventory/traceability/LOT1'],
    ['get', '/api/items'],
    ['get', '/api/orders/gantt'],
    ['get', '/api/users'],
    ['get', '/api/suppliers/validate-vat/DE123456789'],
  ];
  for (const [method, url] of routes) {
    test(`${method.toUpperCase()} ${url} -> 401`, async () => {
      const res = await t.request(t.app)[method](url);
      assert.equal(res.status, 401);
    });
  }

  test('a forged token is rejected', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ id: 1, company_id: 1, role: 'administrator' }, 'guessed-secret');
    const res = await t.client(forged).get('/api/items');
    assert.equal(res.status, 401);
  });
});

describe('roles', () => {
  test('an operator cannot create users or machines', async () => {
    const c = await t.companyWithAdmin('ROLES');
    const op = await t.userClient(c.api, 'ROLES', 'OP1', 'operator');
    assert.equal((await op.api.post('/api/users', { first_name: 'x', last_name: 'y', badge_number: 'Z', role: 'administrator', password: 'abcdefgh1' })).status, 403);
    assert.equal((await op.api.post('/api/machines', { area_id: 1, name: 'x' })).status, 403);
  });

  test('all seven roles can be created (warehouse roles were blocked before)', async () => {
    const c = await t.companyWithAdmin('ROLES2');
    for (const [badge, role] of [['W1', 'warehouse_manager'], ['M1', 'material_planner']]) {
      const res = await c.api.post('/api/users', { first_name: 'a', last_name: 'b', badge_number: badge, role, password: t.PASSWORD });
      assert.equal(res.status, 201);
    }
  });

  test('passwords shorter than 8 characters are rejected', async () => {
    const c = await t.companyWithAdmin('PWD');
    const res = await c.api.post('/api/users', { first_name: 'a', last_name: 'b', badge_number: 'P1', role: 'operator', password: 'short' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'BAD_REQUEST');
  });
});
