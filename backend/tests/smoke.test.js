/**
 * Broad smoke test: every screen's API calls work against PostgreSQL
 * (catches leftover SQLite-only SQL).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let ids = {};

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('SMOKE');
  const op = await t.userClient(c.api, 'SMOKE', 'OP1', 'operator');
  const lead = await t.userClient(c.api, 'SMOKE', 'SL1', 'shift_responsible');
  ids = { op: op.id, lead: lead.id, opApi: op.api, leadApi: lead.api };
  ids.machine = await t.createMachine(c.api, 'Mill');
  ids.item = await t.createItem(c.api, 'PART', 'finished_good', { production_time_min: 1 });
});
after(t.teardown);

const ok = (res, status = 200) => assert.equal(res.status, status, `${res.req?.path}: ${JSON.stringify(res.body)}`);

test('shifts, members, schedule, skills', async () => {
  const shift = await c.api.post('/api/shifts', { name: 'Früh', shift_responsible_id: ids.lead, start_time: '06:00', end_time: '14:00', members: [ids.op, ids.lead] });
  ok(shift, 201);
  ids.shift = shift.body.id;
  ok(await c.api.get('/api/shifts'));
  const detail = await c.api.get(`/api/shifts/${ids.shift}`);
  ok(detail);
  assert.equal(detail.body.members.length, 2);
  ok(await c.api.put(`/api/shifts/${ids.shift}`, { name: 'Frühschicht', members: [ids.op, ids.lead] }));
  ok(await c.api.get('/api/users/shifts/all'));
  ok(await c.api.post('/api/shifts/schedule', { user_id: ids.op, machine_id: ids.machine, shift_id: ids.shift, work_date: '2030-05-01' }), 201);
  ok(await c.api.post('/api/shifts/schedule', { user_id: ids.op, machine_id: ids.machine, shift_id: ids.shift, work_date: '2030-05-01' }), 409);
  ok(await c.api.get('/api/shifts/schedule?date_from=2030-05-01&date_to=2030-05-31'));
  ok(await c.api.post(`/api/users/${ids.op}/skills`, { skills: [{ machine_id: ids.machine, skill_level: 'expert' }] }));
  const skills = await c.api.get(`/api/users/${ids.op}/skills`);
  ok(skills);
  assert.equal(skills.body[0].machine_name, 'Mill');
  ok(await c.api.get('/api/users/operators'));
  ok(await c.api.get('/api/users/by-role/operator'));
});

test('production day: allocation, actions, OEE, performance, optimizer', async () => {
  const order = await c.api.post('/api/orders', { orders: [{ machine_id: ids.machine, item_id: ids.item, quantity: 10, planned_start: '2030-05-01 06:00', planned_end: '2030-05-01 08:00' }] });
  ok(order, 201);
  ids.order = order.body.created[0].id;
  ok(await c.api.post('/api/production/optimize', { shift_id: ids.shift, date: '2030-05-01' }));

  const alloc = await ids.leadApi.post('/api/production/allocations', { order_id: ids.order, operator_id: ids.op, machine_id: ids.machine, start_time: '2030-05-01 06:00', end_time: '2030-05-01 08:00' });
  ok(alloc, 201);
  // Overlapping allocation for the same operator -> conflict with delay proposal
  const conflict = await ids.leadApi.post('/api/production/allocations', { order_id: ids.order, operator_id: ids.op, machine_id: ids.machine, start_time: '2030-05-01 07:00', end_time: '2030-05-01 09:00' });
  ok(conflict, 409);
  assert.equal(conflict.body.delay_minutes, 60);
  assert.ok(Array.isArray(conflict.body.conflicts));

  for (const action of ['setup_start', 'setup_end', 'working_start', 'delay_start', 'delay_end']) {
    ok(await ids.opApi.post('/api/production/actions', { allocation_id: alloc.body.id, action_type: action }), 201);
  }
  ok(await ids.opApi.get(`/api/production/operator/${ids.op}`));
  ok(await ids.opApi.get(`/api/production/actions/${alloc.body.id}`));
  ok(await c.api.get(`/api/production/machine/${ids.machine}/status`));
  ok(await ids.opApi.post('/api/production/results', { order_id: ids.order, qty_ok: 4, qty_fail: 1 }), 201);
  ok(await c.api.get(`/api/production/results/${ids.order}`));
  ok(await c.api.get('/api/production/performance'));
  ok(await c.api.get('/api/production/allocations?machine_id=' + ids.machine));

  const oee = await c.api.get('/api/oee?date_from=2030-05-01');
  ok(oee);
  assert.equal(oee.body.results.length, 1);
  assert.equal(oee.body.results[0].metrics.total_produced, 5);
  ok(await c.api.get('/api/analytics/summary'));
  ok(await c.api.get('/api/orders/delay-reasons'));
  ok(await c.api.get(`/api/orders/${ids.order}/delays`));
  ok(await c.api.get(`/api/orders/${ids.order}/materials`));
  ok(await c.api.put(`/api/orders/${ids.order}`, { planned_start: '2030-05-01 07:00', planned_end: '2030-05-01 09:00' }));
});

test('shift reports pick up operator delays', async () => {
  const report = await ids.leadApi.post('/api/shift-reports', {
    shift_id: ids.shift, report_date: '2030-05-01', general_notes: 'ok',
    issues: [{ machine_id: ids.machine, order_id: ids.order, description: 'Tool broke', delay_minutes: 15 }],
  });
  ok(report, 201);
  ok(await ids.leadApi.post(`/api/shift-reports/${report.body.id}/issues`, { description: 'Another', delay_minutes: 0 }), 201);
  ok(await ids.leadApi.put(`/api/shift-reports/${report.body.id}`, { general_notes: 'updated' }));
  ok(await ids.leadApi.get(`/api/shift-reports/${report.body.id}`));
  const list = await ids.leadApi.get('/api/shift-reports?date_from=2030-01-01');
  ok(list);
  assert.ok(list.body[0].issues.length >= 2);
});

test('maintenance', async () => {
  ok(await c.api.post('/api/maintenance/config', { machine_id: ids.machine, interval_hours: 100 }));
  ok(await c.api.post('/api/maintenance/log', { machine_id: ids.machine, notes: 'Oil change' }));
  const status = await c.api.get('/api/maintenance/status');
  ok(status);
  assert.equal(status.body[0].interval_hours, 100);
});

test('warehouses, locations, barcode scan, transfers', async () => {
  const wh = await c.api.post('/api/warehousing/warehouses', { name: 'Hauptlager', type: 'central' });
  ok(wh);
  const loc1 = await c.api.post('/api/warehousing/locations', { warehouse_id: wh.body.id, zone: 'A', shelf: '1', bin: '1', barcode: 'A-1-1' });
  const loc2 = await c.api.post('/api/warehousing/locations', { warehouse_id: wh.body.id, zone: 'B', barcode: 'B-1-1' });
  ok(loc1); ok(loc2);
  ok(await c.api.get(`/api/warehousing/locations/${wh.body.id}`));

  const raw = await t.createItem(c.api, 'RAW', 'raw_material');
  ok(await c.api.post('/api/procurement/receipts', { items: [{ item_id: raw, lot_number: 'LOT-RAW', quantity_received: 10, location_id: loc1.body.id }] }));
  const scan = await c.api.get('/api/warehousing/locations/scan/A-1-1');
  ok(scan);
  assert.equal(scan.body.stock.length, 1);

  ok(await c.api.post('/api/inventory/transfers', { from_warehouse_id: wh.body.id, to_warehouse_id: wh.body.id, created_by: 1,
    items: [{ item_id: raw, lot_number: 'LOT-RAW', quantity: 4, from_location_id: loc1.body.id, to_location_id: loc2.body.id }] }));
  ok(await c.api.post('/api/inventory/transfers', { items: [{ item_id: raw, lot_number: 'LOT-RAW', quantity: 400 }] }), 400);
  ok(await c.api.get(`/api/stock/transactions/${raw}`));
  ok(await c.api.post('/api/stock/adjust', { item_id: raw, quantity: 12, notes: 'Inventur' }));
});

test('BOM editing, flat export, item-supplier links, deletes', async () => {
  const raw = (await c.api.get('/api/items?type=raw_material')).body[0].id;
  const bom = await c.api.post('/api/boms', { parent_item_id: ids.item, name: 'PART BOM', tree: [
    { node_type: 'department', department: 'SF01', children: [{ item_id: raw, quantity: '1.5' }] },
  ] });
  ok(bom, 201);
  ok(await c.api.put(`/api/boms/${bom.body.id}`, { parent_item_id: ids.item, name: 'PART BOM v2', tree: [{ item_id: raw, quantity: 2 }] }));
  ok(await c.api.get(`/api/boms/${bom.body.id}/flat`));
  ok(await c.api.get(`/api/boms/by-item/${ids.item}`));
  ok(await c.api.get('/api/boms'));
  ok(await c.api.post('/api/boms/requirements', { name: 'CE' }), 201);
  ok(await c.api.get('/api/boms/requirements'));

  const sup = await c.api.post('/api/suppliers', { name: 'Lieferant' });
  ok(await c.api.post('/api/suppliers/item', { item_id: raw, supplier_id: sup.body.id, purchase_price: 3, is_primary: true }));
  ok(await c.api.post('/api/suppliers/item', { item_id: raw, supplier_id: sup.body.id, purchase_price: 4 }));
  const links = await c.api.get(`/api/suppliers/item/${raw}`);
  ok(links);
  assert.equal(links.body.length, 1);
  assert.equal(links.body[0].purchase_price, 4);
  ok(await c.api.delete(`/api/suppliers/item/${raw}/${sup.body.id}`));

  ok(await c.api.delete(`/api/boms/${bom.body.id}`));
  const areas = (await c.api.get('/api/machines/areas')).body;
  ok(await c.api.delete(`/api/machines/areas/${areas[0].id}`));
  assert.equal((await c.api.get('/api/machines/areas')).body.length, areas.length - 1);
});
