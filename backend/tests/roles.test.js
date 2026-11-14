/**
 * Several roles per user: access is the union of all roles.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('ROLES');
});
after(t.teardown);

test('a user created with one role has it as the only role', async () => {
  const u = await t.userClient(c.api, 'ROLES', 'S1', 'sales');
  const users = (await c.api.get('/api/users')).body;
  assert.deepEqual(users.find((x) => x.id === u.id).roles, ['sales']);
  assert.equal((await u.api.get('/api/customers')).status, 200);
  assert.equal((await u.api.get('/api/stock')).status, 200); // read access stays open
  assert.equal((await u.api.post('/api/procurement/purchase-orders', {})).status, 403);
});

test('a user with several roles gets the access of all of them', async () => {
  const res = await c.api.post('/api/users', {
    first_name: 'Owner', last_name: 'Multi', badge_number: 'M1', password: t.PASSWORD,
    roles: ['planner', 'sales', 'accounting'],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const login = await t.request(t.app).post('/api/auth/login').send({ company_code: 'ROLES', badge_number: 'M1', password: t.PASSWORD });
  assert.deepEqual(login.body.user.roles, ['planner', 'sales', 'accounting']);
  assert.equal(login.body.user.role, 'planner');
  const api = t.client(login.body.token);

  assert.equal((await api.get('/api/datev/export?from=2030-01-01&to=2030-01-31')).status === 403, false); // accounting
  assert.equal((await api.post('/api/customers', { name: 'Kunde' })).status, 201); // sales
  assert.equal((await api.get('/api/users')).status, 403); // not administrator
  const me = await api.get('/api/auth/me');
  assert.deepEqual(me.body.roles, ['planner', 'sales', 'accounting']);
});

test('roles can be changed; "role" alone still means a single role', async () => {
  const id = (await c.api.post('/api/users', { first_name: 'A', last_name: 'B', badge_number: 'X1', password: t.PASSWORD, role: 'operator' })).body.id;
  await c.api.put(`/api/users/${id}`, { roles: ['operator', 'warehouse_manager'] }).expect(200);
  let u = (await c.api.get('/api/users')).body.find((x) => x.id === id);
  assert.deepEqual(u.roles, ['operator', 'warehouse_manager']);
  assert.equal(u.role, 'operator');
  // Operators list includes users who have the operator role among others
  assert.ok((await c.api.get('/api/users/operators')).body.some((x) => x.id === id));

  await c.api.put(`/api/users/${id}`, { role: 'planner' }).expect(200);
  u = (await c.api.get('/api/users')).body.find((x) => x.id === id);
  assert.deepEqual(u.roles, ['planner']);

  assert.equal((await c.api.put(`/api/users/${id}`, { roles: ['boss'] })).status, 400);
  assert.equal((await c.api.put(`/api/users/${id}`, { roles: [] })).status, 400);
});

test('administrators cannot remove their own administrator role', async () => {
  const me = (await c.api.get('/api/auth/me')).body;
  assert.equal((await c.api.put(`/api/users/${me.id}`, { roles: ['planner'] })).status, 400);
  assert.equal((await c.api.put(`/api/users/${me.id}`, { roles: ['administrator', 'planner'] })).status, 200);
});
