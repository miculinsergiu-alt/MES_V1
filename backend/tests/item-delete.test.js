/**
 * Deleting items: unused items go, items in use (orders, stock, BOMs …) stay
 * and are reported; roles and tenant isolation are respected.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let other; let op; let machine;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('DELI');
  other = await t.companyWithAdmin('DELI2');
  op = await t.userClient(c.api, 'DELI', 'OPD', 'operator');
  machine = await t.createMachine(c.api, 'Säge');
});
after(t.teardown);

test('bulk delete by item code removes unused items and keeps used ones', async () => {
  const free1 = await t.createItem(c.api, 'FREE-1', 'raw_material');
  await t.createItem(c.api, 'FREE-2', 'finished_good');
  const ordered = await t.createItem(c.api, 'ORDERED', 'finished_good');
  const stocked = await t.createItem(c.api, 'STOCKED', 'raw_material');
  await c.api.post('/api/orders', { orders: [{ machine_id: machine, item_id: ordered, quantity: 5, planned_start: '2030-05-06 06:00' }] }).expect(201);
  await c.api.post('/api/stock/adjust', { item_id: stocked, quantity: 10 }).expect(200);
  const otherItem = await t.createItem(other.api, 'FREE-1', 'raw_material');

  await op.api.post('/api/items/delete', { item_codes: ['FREE-1'] }).expect(403);
  await c.api.post('/api/items/delete', {}).expect(400);

  const r = (await c.api.post('/api/items/delete', { item_codes: ['FREE-1', 'FREE-2', 'ORDERED', 'STOCKED', 'NOPE'] }).expect(200)).body;
  assert.equal(r.deleted, 2);
  assert.equal(r.not_found, 1);
  assert.deepEqual(r.blocked.map((b) => b.item_code).sort(), ['ORDERED', 'STOCKED']);

  const codes = (await c.api.get('/api/items')).body.map((i) => i.item_code).sort();
  assert.deepEqual(codes, ['ORDERED', 'STOCKED']);
  await c.api.get(`/api/items/${free1}`).expect(404);
  // the other company's item with the same code is untouched
  await other.api.get(`/api/items/${otherItem}`).expect(200);
});

test('delete one item by id; in use -> 400; foreign company -> 404', async () => {
  const id = await t.createItem(c.api, 'SINGLE', 'raw_material');
  const otherId = await t.createItem(other.api, 'OTHER-ONLY', 'raw_material');
  await c.api.delete(`/api/items/${otherId}`).expect(404);
  await c.api.delete(`/api/items/${id}`).expect(200);
  await c.api.get(`/api/items/${id}`).expect(404);
  const ordered = (await c.api.get('/api/items')).body.find((i) => i.item_code === 'ORDERED');
  const r = await c.api.delete(`/api/items/${ordered.id}`).expect(400);
  assert.match(r.body.error || r.body.message || '', /cannot be deleted/);
});

test('bulk delete by ids, also a BOM component is protected', async () => {
  const parent = await t.createItem(c.api, 'ASSY', 'finished_good');
  const comp = await t.createItem(c.api, 'COMP', 'raw_material');
  const bom = await c.api.post('/api/boms', { parent_item_id: parent, name: 'ASSY BOM', tree: [{ item_id: comp, quantity: 2 }] });
  assert.ok([200, 201].includes(bom.status), JSON.stringify(bom.body));
  const r = (await c.api.post('/api/items/delete', { ids: [parent, comp] }).expect(200)).body;
  assert.equal(r.deleted, 0);
  assert.equal(r.blocked.length, 2);
});
