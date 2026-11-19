/**
 * Tool management: usage counted from production results, wear warnings,
 * replacement with spares, regrind, today list.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let op; let machine; let other; let tool; let orderId;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('TOOLS');
  other = await t.companyWithAdmin('TOOLS2');
  machine = await t.createMachine(c.api, 'DMU 50');
  op = await t.userClient(c.api, 'TOOLS', 'OPW', 'operator');
  const item = await t.createItem(c.api, 'PLATTE', 'finished_good');
  orderId = (await c.api.post('/api/orders', { orders: [{ machine_id: machine, item_id: item, quantity: 500, planned_start: '2030-05-06 06:00' }] })).body.created[0].id;
});
after(t.teardown);

test('create a tool mounted on a machine', async () => {
  const r = await c.api.post('/api/tools', { code: 'VHM-10', name: 'VHM-Fräser Ø10', tool_type: 'Fräser', machine_id: machine, life_limit_parts: 200, spare_count: 1, min_spares: 2 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  tool = r.body;
  assert.equal(tool.wear_percent, 0);
  assert.equal(tool.spares_low, true);
  await c.api.post('/api/tools', { code: 'VHM-10', name: 'dup' }).expect(409);
  await op.api.post('/api/tools', { code: 'X', name: 'x' }).expect(403);
});

test('production results count the parts; near end of life it is flagged', async () => {
  await c.api.post('/api/production/results', { order_id: orderId, qty_ok: 170, qty_fail: 15 }).expect(201);
  const list = (await op.api.get(`/api/tools?machine_id=${machine}`)).body;
  assert.equal(list[0].used_parts, 185);
  assert.equal(list[0].wear_percent, 93);
  assert.equal(list[0].worn, true);
  const today = (await c.api.get('/api/today')).body;
  assert.equal(today.counts.tools_worn, 1);
  assert.equal(today.counts.tool_spares_low, 1);
});

test('replace uses a spare and resets the counter; regrind keeps the spares; no spare -> refused', async () => {
  const r = (await op.api.post(`/api/tools/${tool.id}/replace`, { kind: 'replaced' }).expect(200)).body;
  assert.equal(r.used_parts, 0);
  assert.equal(r.spare_count, 0);
  await c.api.post(`/api/tools/${tool.id}/replace`, { kind: 'replaced' }).expect(400);
  await c.api.post(`/api/tools/${tool.id}/replace`, { kind: 'regrind' }).expect(200);
  await c.api.post(`/api/tools/${tool.id}/spares`, { quantity: 5 }).expect(200);
  const events = (await c.api.get(`/api/tools/${tool.id}/events`)).body;
  assert.deepEqual(events.map((e) => e.kind), ['spares_added', 'regrind', 'replaced', 'mounted']);
  assert.equal(events[2].used_parts_before, 185);
  assert.equal((await other.api.get('/api/tools')).body.length, 0);
});
