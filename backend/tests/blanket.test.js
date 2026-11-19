/**
 * Blanket orders (Rahmenaufträge): call-offs become order confirmations at the
 * agreed price, remaining quantity, validity, deleted drafts release quantity.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let other; let item; let customer; let bo;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('RAHMEN');
  other = await t.companyWithAdmin('RAHMEN2');
  item = await t.createItem(c.api, 'HALTER-9', 'finished_good', { unit_price: 15 });
  customer = (await c.api.post('/api/customers', { name: 'Serien AG', street: 'Weg 1', postal_code: '80331', city: 'München' })).body;
});
after(t.teardown);

test('create a blanket order: number, lines, validity check', async () => {
  await c.api.post('/api/blanket-orders', { customer_id: customer.id, valid_from: '2026-12-01', valid_to: '2026-01-01', lines: [{ item_id: item, quantity: 10, unit_price: 1 }] }).expect(400);
  const res = await c.api.post('/api/blanket-orders', {
    customer_id: customer.id, customer_reference: 'RV-2026-77', valid_from: '2026-01-01', valid_to: '2030-12-31',
    lines: [{ item_id: item, quantity: 1000, unit_price: 12.4 }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  bo = res.body;
  assert.match(bo.number, /^RA-\d{4}-0001$/);
  assert.equal(bo.lines[0].remaining, 1000);
});

test('a call-off creates an order confirmation at the agreed price and reduces the remaining quantity', async () => {
  const r = await c.api.post(`/api/blanket-orders/${bo.id}/call-off`, { delivery_date: '2027-02-15', lines: [{ line_id: bo.lines[0].id, quantity: 300 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.document.doc_type, 'order');
  assert.equal(Number(r.body.document.lines[0].unit_price), 12.4); // not the item price 15
  assert.match(r.body.document.customer_reference, /RV-2026-77/);
  assert.equal(r.body.blanket.lines[0].remaining, 700);
  assert.equal(r.body.blanket.calloffs.length, 1);
  await c.api.post(`/api/blanket-orders/${bo.id}/call-off`, { lines: [{ line_id: bo.lines[0].id, quantity: 701 }] }).expect(400);
  await c.api.post(`/api/blanket-orders/${bo.id}/call-off`, { delivery_date: '2031-01-10', lines: [{ line_id: bo.lines[0].id, quantity: 1 }] }).expect(400);
  // lines are frozen after the first call-off
  await c.api.put(`/api/blanket-orders/${bo.id}`, { lines: [{ item_id: item, quantity: 5, unit_price: 1 }] }).expect(400);
});

test('deleting a call-off draft releases its quantity; the rest closes the blanket order', async () => {
  const r = await c.api.post(`/api/blanket-orders/${bo.id}/call-off`, { lines: [{ line_id: bo.lines[0].id, quantity: 200 }] }).expect(201);
  assert.equal(r.body.blanket.lines[0].remaining, 500);
  await c.api.delete(`/api/sales/${r.body.document.id}`).expect(200);
  assert.equal((await c.api.get(`/api/blanket-orders/${bo.id}`)).body.lines[0].remaining, 700);
  const last = await c.api.post(`/api/blanket-orders/${bo.id}/call-off`, { lines: [{ line_id: bo.lines[0].id, quantity: 700 }] }).expect(201);
  assert.equal(last.body.blanket.status, 'closed');
  await c.api.post(`/api/blanket-orders/${bo.id}/call-off`, { lines: [{ line_id: bo.lines[0].id, quantity: 1 }] }).expect(400);
});

test('other companies see nothing', async () => {
  await other.api.get(`/api/blanket-orders/${bo.id}`).expect(404);
  assert.equal((await other.api.get('/api/blanket-orders?status=all')).body.length, 0);
});
