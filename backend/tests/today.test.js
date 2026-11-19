/**
 * "Today" exception list: items from several modules, filtered by role.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let op; let sales;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('TODAY');
  op = await t.userClient(c.api, 'TODAY', 'OPT', 'operator');
  sales = await t.userClient(c.api, 'TODAY', 'VKT', 'sales');
  const machine = await t.createMachine(c.api, 'M1');
  const item = await t.createItem(c.api, 'TEIL', 'finished_good', { unit_price: 10 });
  // late production order (planned in the past)
  await c.api.post('/api/orders', { orders: [{ machine_id: machine, item_id: item, quantity: 5, planned_start: '2020-01-06 06:00', planned_end: '2020-01-06 08:00' }] }).expect(201);
  // overdue gauge
  await c.api.post('/api/quality/gauges', { code: 'G1', name: 'Lehre', interval_months: 1, last_calibrated: '2020-01-01' }).expect(201);
  // overdue invoice
  await c.api.put('/api/settings/company', { legal_name: 'Today GmbH', street: 'Weg 1', postal_code: '10115', city: 'Berlin', vat_id: 'DE123456789', iban: 'DE89370400440532013000' }).expect(200);
  const cust = (await c.api.post('/api/customers', { name: 'Zahlt spät GmbH', street: 'Str. 1', postal_code: '80331', city: 'München' })).body;
  const inv = await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: cust.id, document_date: '2020-02-01', lines: [{ description: 'Teile', quantity: 1, unit_price: 100 }] });
  await c.api.post(`/api/sales/${inv.body.id}/issue`, {}).expect(200);
});
after(t.teardown);

test('the administrator sees everything, most urgent first', async () => {
  const r = (await c.api.get('/api/today').expect(200)).body;
  assert.ok(r.counts.late_orders >= 1);
  assert.equal(r.counts.gauges_due, 1);
  assert.equal(r.counts.invoices_overdue, 1);
  assert.equal(r.items[0].severity, 'high');
  assert.ok(r.items.find((x) => x.category === 'invoices_overdue').amount > 0);
});

test('roles see only their part', async () => {
  const s = (await sales.api.get('/api/today')).body;
  assert.equal(s.counts.invoices_overdue, 1);
  assert.equal(s.counts.late_orders, undefined);
  assert.equal(s.counts.gauges_due, undefined);
  const o = (await op.api.get('/api/today')).body;
  assert.equal(o.total, 0);
});
