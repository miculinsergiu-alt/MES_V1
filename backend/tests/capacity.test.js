/**
 * Capacity load per machine and week; delivery date check on the current
 * schedule, including material lead time and outside processing.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let mill; let raw; let part; let supplier;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('CAP');
  mill = await t.createMachine(c.api, 'Fräse 1');
  await c.api.put(`/api/machines/${mill}`, { weekly_hours: 40 }).expect(200);
  supplier = (await c.api.post('/api/suppliers', { name: 'Härterei' })).body.id;
  raw = await t.createItem(c.api, 'STAHL', 'raw_material', { lead_time_days: 5 });
  part = await t.createItem(c.api, 'ZAHNRAD', 'finished_good');
  await c.api.post('/api/boms', { parent_item_id: part, name: 'Zahnrad', tree: [{ item_id: raw, quantity: 1, node_type: 'component' }] }).expect(201);
  await c.api.put(`/api/items/${part}`, { routes: [
    { machine_id: mill, setup_time_min: 60, process_time_min: 6 },
    { step_type: 'external', supplier_id: supplier, external_days: 3 },
  ] }).expect(200);
});
after(t.teardown);

test('load per week: planned order hours against weekly capacity', async () => {
  // 1 h setup + 100 × 6 min = 11 h on Monday 2030-04-01
  await c.api.post('/api/orders', { orders: [{ item_id: part, quantity: 100, planned_start: '2030-04-01 06:00' }] }).expect(201);
  const res = (await c.api.get('/api/capacity/load?from=2030-04-03&weeks=2').expect(200)).body;
  assert.deepEqual(res.weeks, ['2030-04-01', '2030-04-08']);
  const m = res.machines.find((x) => x.id === mill);
  assert.equal(m.weeks[0].planned_hours, 11);
  assert.equal(m.weeks[0].load_percent, 28); // 11 / 40
  assert.equal(m.weeks[1].planned_hours, 0);
});

test('delivery date check: waits for the machine, material lead time and outside processing', async () => {
  const res = await c.api.post('/api/capacity/check', { item_id: part, quantity: 10, start: '2030-04-01 06:00', desired_date: '2030-04-05' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const b = res.body;
  // no stock: material lead time 5 days -> starts 2030-04-06 06:00; machine is free again by then
  assert.equal(b.material[0].short, true);
  assert.equal(b.steps[0].start.slice(0, 16), '2030-04-06 06:00');
  assert.equal(b.steps[0].end.slice(0, 16), '2030-04-06 08:00'); // 60 + 10 × 6 min
  assert.equal(b.steps[1].step_type, 'external');
  assert.equal(b.earliest_delivery_date, '2030-04-09');
  assert.equal(b.feasible, false);
  assert.equal(b.days_late, 4);
});

test('with material in stock the machine queue decides', async () => {
  await c.api.post('/api/procurement/receipts', { items: [{ item_id: raw, lot_number: 'S1', quantity_received: 50 }] }).expect(200);
  const b = (await c.api.post('/api/capacity/check', { item_id: part, quantity: 10, start: '2030-04-01 06:00' })).body;
  // the 100-piece order occupies the mill until 17:00 → our job starts after it
  assert.equal(b.steps[0].start.slice(0, 16), '2030-04-01 17:00');
  assert.equal(b.steps[0].waits_for_machine, true);
  await c.api.post('/api/capacity/check', { item_id: raw, quantity: 1 }).expect(400); // no routing
});
