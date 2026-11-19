/**
 * Quality: inspection plan, measurements (out of tolerance -> hold + lot in
 * quarantine), release, report PDF, gauges with calibration due dates,
 * complaints with 8D and containment.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let other; let op; let lathe; let item; let orderId; let plan; let gauge;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('QMS');
  other = await t.companyWithAdmin('QMS2');
  lathe = await t.createMachine(c.api, 'Drehe');
  item = await t.createItem(c.api, 'BOLZEN-25', 'finished_good', { unit_price: 8 });
  op = await t.userClient(c.api, 'QMS', 'OPQ', 'operator');
});
after(t.teardown);

test('gauges: next calibration date follows the interval; overdue gauges are flagged', async () => {
  const g = await c.api.post('/api/quality/gauges', { code: 'MS-01', name: 'Messschieber 150', interval_months: 12, last_calibrated: '2026-01-15' });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  assert.equal(g.body.next_due, '2027-01-15');
  gauge = g.body;
  await c.api.post('/api/quality/gauges', { code: 'MS-01', name: 'dup' }).expect(409);
  const old = (await c.api.post('/api/quality/gauges', { code: 'MB-02', name: 'Bügelmessschraube', interval_months: 6, last_calibrated: '2020-01-01' })).body;
  const list = (await c.api.get('/api/quality/gauges')).body;
  assert.equal(list.find((x) => x.id === old.id).overdue, true);
  const cal = await c.api.post(`/api/quality/gauges/${old.id}/calibrated`, { date: '2026-11-01' }).expect(200);
  assert.equal(cal.body.next_due, '2027-05-01');
});

test('inspection plan: limits are validated; the plan is stored per item', async () => {
  await c.api.put(`/api/quality/plans/${item}`, { characteristics: [{ name: 'Ø 25', nominal: 25 }] }).expect(400);
  await c.api.put(`/api/quality/plans/${item}`, { characteristics: [{ name: 'Ø 25', nominal: 25, lower_limit: 25.1, upper_limit: 25 }] }).expect(400);
  const res = await c.api.put(`/api/quality/plans/${item}`, {
    characteristics: [
      { name: 'Ø 25 h7', nominal: 25, lower_limit: 24.979, upper_limit: 25, unit: 'mm', frequency: 'every_n', every_n: 10, critical: 1, gauge_id: gauge.id },
      { name: 'Oberfläche', kind: 'attribute', frequency: 'final' },
    ],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  plan = res.body;
  assert.equal(plan.length, 2);
  assert.equal(plan[0].gauge_code, 'MS-01');
});

test('first article inside tolerance: nothing to hold; due list shows what is next', async () => {
  orderId = (await c.api.post('/api/orders', { orders: [{ machine_id: lathe, item_id: item, quantity: 30, planned_start: '2030-02-01 06:00' }] })).body.created[0].id;
  let st = (await c.api.get(`/api/quality/orders/${orderId}/inspection`)).body;
  assert.deepEqual(st.due.map((d) => d.stage), ['first']);
  const r = await op.api.post(`/api/quality/orders/${orderId}/measurements`, { stage: 'first', values: [{ characteristic_id: plan[0].id, value: 24.99 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.hold, false);
  st = (await c.api.get(`/api/quality/orders/${orderId}/inspection`)).body;
  assert.equal(st.due.length, 0);
});

test('out of tolerance puts the order on hold and its production lot into quarantine', async () => {
  await c.api.post('/api/production/results', { order_id: orderId, qty_ok: 12 }).expect(201);
  let st = (await c.api.get(`/api/quality/orders/${orderId}/inspection`)).body;
  assert.deepEqual(st.due.map((d) => [d.stage, d.count]), [['in_process', 1]]); // every 10 parts
  const r = await op.api.post(`/api/quality/orders/${orderId}/measurements`, { stage: 'in_process', values: [{ characteristic_id: plan[0].id, value: 25.02 }] });
  assert.equal(r.body.hold, true);
  const q = (await c.api.get('/api/quality/quarantine')).body;
  assert.ok(q.some((x) => x.lot_number === `FA-${orderId}` && Number(x.quantity) === 12));
  // more parts booked while on hold: the quarantine covers the whole lot
  await c.api.post('/api/production/results', { order_id: orderId, qty_ok: 3 }).expect(201);
  const q2 = (await c.api.get('/api/quality/quarantine')).body.find((x) => x.lot_number === `FA-${orderId}`);
  assert.equal(Number(q2.quantity), 15);
  // operators cannot release; quality can
  await op.api.post(`/api/quality/orders/${orderId}/release`, {}).expect(403);
  st = (await c.api.post(`/api/quality/orders/${orderId}/release`, {}).expect(200)).body;
  assert.equal(st.order.quality_hold, 0);
});

test('an overdue gauge cannot be used; attribute checks; report PDF', async () => {
  const old = (await c.api.get('/api/quality/gauges')).body.find((x) => x.code === 'MB-02');
  await c.api.put(`/api/quality/gauges/${old.id}`, { last_calibrated: '2020-01-01' }).expect(200);
  await c.api.post(`/api/quality/orders/${orderId}/measurements`, { stage: 'final', gauge_id: old.id, values: [{ characteristic_id: plan[0].id, value: 24.99 }] }).expect(400);
  await c.api.post(`/api/quality/orders/${orderId}/measurements`, { stage: 'final', values: [{ characteristic_id: plan[1].id }] }).expect(400);
  await c.api.post(`/api/quality/orders/${orderId}/measurements`, { stage: 'final', values: [{ characteristic_id: plan[1].id, ok: true }] }).expect(201);
  const pdf = await c.api.get(`/api/quality/orders/${orderId}/report.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
});

test('complaint: number, containment of the lot, 8D needs D8 before closing, PDF', async () => {
  const customer = (await c.api.post('/api/customers', { name: 'Reklamierer GmbH' })).body;
  // release the earlier quarantine first so containment creates a new case
  const q = (await c.api.get('/api/quality/quarantine')).body.find((x) => x.lot_number === `FA-${orderId}`);
  await c.api.put(`/api/quality/quarantine/${q.id}/resolve`, { decision: 'released' }).expect(200);
  const cp = await c.api.post('/api/quality/complaints', { customer_id: customer.id, item_id: item, lot_number: `FA-${orderId}`, quantity: 3, description: 'Durchmesser zu groß' });
  assert.equal(cp.status, 201, JSON.stringify(cp.body));
  assert.match(cp.body.number, /^QM-\d{4}-0001$/);
  assert.ok((await c.api.get('/api/quality/quarantine')).body.some((x) => x.lot_number === `FA-${orderId}` && /complaint/.test(x.reason)));
  await c.api.put(`/api/quality/complaints/${cp.body.id}`, { status: 'closed' }).expect(400);
  const closed = await c.api.put(`/api/quality/complaints/${cp.body.id}`, { d4_root_cause: 'Werkzeugverschleiß', d8_closure: 'Wirksam, Kunde informiert', status: 'closed' });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.ok(closed.body.closed_at);
  assert.equal((await c.api.get('/api/quality/complaints')).body.length, 0); // open list
  const pdf = await c.api.get(`/api/quality/complaints/${cp.body.id}/8d.pdf`);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  await other.api.get(`/api/quality/complaints/${cp.body.id}`).expect(404);
});
