/**
 * Outside processing (Fremdbearbeitung): external routing step -> subcontract
 * job -> send (purchase order + delivery note) -> receive -> costing.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let other; let mill; let drill; let supplier; let item; let rootId; let job;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('SUBCO');
  other = await t.companyWithAdmin('SUBCO2');
  mill = await t.createMachine(c.api, 'Fräse');
  drill = await t.createMachine(c.api, 'Bohrwerk');
  supplier = (await c.api.post('/api/suppliers', { name: 'Eloxal Müller GmbH' })).body.id;
  item = await t.createItem(c.api, 'GEH-01', 'finished_good', { unit_price: 30 });
});
after(t.teardown);

test('routing validation: external steps need a subcontractor; the first step must be internal', async () => {
  await c.api.put(`/api/items/${item}`, { routes: [{ step_type: 'external', supplier_id: supplier, external_days: 3 }] }).expect(400);
  await c.api.put(`/api/items/${item}`, { routes: [{ machine_id: mill, process_time_min: 5 }, { step_type: 'external' }] }).expect(400);
  await c.api.put(`/api/items/${item}`, {
    routes: [
      { machine_id: mill, process_time_min: 6, setup_time_min: 30 },
      { step_type: 'external', supplier_id: supplier, external_days: 5, external_price: 1.2, external_min_charge: 80, notes: 'Eloxieren schwarz E6/EV1' },
      { machine_id: drill, process_time_min: 2 },
    ],
  }).expect(200);
  const routes = (await c.api.get(`/api/items/${item}`)).body.routes;
  assert.deepEqual(routes.map((r) => r.step_type), ['internal', 'external', 'internal']);
  assert.equal(routes[1].supplier_name, 'Eloxal Müller GmbH');
});

test('a production order plans the external step as a subcontract job; later steps wait for the return', async () => {
  const res = await c.api.post('/api/orders', { orders: [{ item_id: item, quantity: 50, planned_start: '2030-03-04 06:00' }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const created = res.body.created;
  assert.equal(created.length, 2); // two machine steps
  rootId = created[0].id;
  // first step: 30 min setup + 50 × 6 min
  assert.equal(created[0].planned_end.slice(0, 16), '2030-03-04 11:30');
  const jobs = (await c.api.get(`/api/subcontracting?order_id=${rootId}`)).body;
  assert.equal(jobs.length, 1);
  job = jobs[0];
  assert.equal(job.status, 'planned');
  assert.equal(job.planned_send.slice(0, 16), '2030-03-04 11:30');
  assert.equal(job.planned_return.slice(0, 16), '2030-03-09 11:30');
  assert.equal(job.planned_cost, 80); // 50 × 1.20 = 60 < minimum charge 80
  assert.ok(created[1].planned_start >= '2030-03-09 11:30');
});

test('send creates a subcontract purchase order and an outgoing delivery note', async () => {
  await c.api.post(`/api/subcontracting/${job.id}/receive`, { qty_ok: 1 }).expect(400); // not sent yet
  const sent = await c.api.post(`/api/subcontracting/${job.id}/send`, { quantity: 50 });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.status, 'sent');
  assert.match(sent.body.delivery_note_number, /^LL-\d{4}-00001$/);
  assert.match(sent.body.po_number, /^BE-/);
  const po = (await c.api.get('/api/procurement/purchase-orders')).body.find((p) => p.id === sent.body.po_id);
  assert.equal(po.po_type, 'subcontract');
  const pdf = await c.api.get(`/api/subcontracting/${job.id}/delivery-note.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  await c.api.post(`/api/subcontracting/${job.id}/send`, {}).expect(400); // only once
});

test('receive books good and scrap parts and the cost goes into the Nachkalkulation', async () => {
  await c.api.post(`/api/subcontracting/${job.id}/receive`, { qty_ok: 49, qty_fail: 2 }).expect(400); // more than sent
  const r = await c.api.post(`/api/subcontracting/${job.id}/receive`, { qty_ok: 49, qty_fail: 1, actual_cost: 85 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'received');
  const cost = (await c.api.get(`/api/reports/costing/${rootId}`)).body;
  assert.equal(cost.planned.external, 80);
  assert.equal(cost.actual.external, 85);
  assert.equal(cost.external[0].supplier_name, 'Eloxal Müller GmbH');
  assert.equal((await c.api.get('/api/subcontracting?status=open')).body.length, 0);
});

test('other companies see nothing', async () => {
  assert.equal((await other.api.get('/api/subcontracting')).body.length, 0);
  await other.api.get(`/api/subcontracting/${job.id}`).expect(404);
});
