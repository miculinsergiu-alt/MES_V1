/**
 * Customer-supplied material (Beistellung): received at no cost, used only
 * (and first) for that customer's orders, not part of the stock value.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let machine; let raw; let part; let custA; let custB;

const prodOrderFor = async (customer, qty) => {
  const o = await c.api.post('/api/sales', { doc_type: 'order', customer_id: customer.id, lines: [{ item_id: part, quantity: qty, unit_price: 50 }] });
  await c.api.post(`/api/sales/${o.body.id}/issue`, { create_production: { planned_start: '2030-03-01 06:00' } }).expect(200);
  return (await c.api.get(`/api/sales/${o.body.id}`)).body.lines[0].production_order_id;
};
const lotQty = async (n) => Number((await c.api.get(`/api/trace/${n}`)).body.lot.quantity);

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('BEIST');
  machine = await t.createMachine(c.api, 'Säge');
  await c.api.put('/api/settings/company', { legal_name: 'Beist GmbH', street: 'Weg 1', postal_code: '10115', city: 'Berlin', vat_id: 'DE123456789' }).expect(200);
  raw = await t.createItem(c.api, 'ROHR-30', 'raw_material', { acquisition_cost: 5 });
  part = await t.createItem(c.api, 'HUELSE', 'finished_good', { unit_price: 50 });
  await c.api.post('/api/boms', { parent_item_id: part, name: 'Hülse', tree: [{ item_id: raw, quantity: 1, node_type: 'component' }] }).expect(201);
  await c.api.put(`/api/items/${part}`, { routes: [{ machine_id: machine, process_time_min: 1 }] }).expect(200);
  custA = (await c.api.post('/api/customers', { name: 'Kunde A' })).body;
  custB = (await c.api.post('/api/customers', { name: 'Kunde B' })).body;
});
after(t.teardown);

test('customer material is received without a purchase order and at no cost', async () => {
  const po = (await c.api.post('/api/procurement/purchase-orders', { supplier_id: (await c.api.post('/api/suppliers', { name: 'L' })).body.id, items: [{ item_id: raw, quantity_ordered: 1, unit_price: 5 }] })).body;
  await c.api.post('/api/procurement/receipts', { po_id: po.id, customer_id: custA.id, items: [{ item_id: raw, lot_number: 'X1', quantity_received: 1 }] }).expect(400);
  await c.api.post('/api/procurement/receipts', { items: [{ item_id: raw, lot_number: 'OWN-1', quantity_received: 10 }] }).expect(200);
  await c.api.post('/api/procurement/receipts', { customer_id: custA.id, items: [{ item_id: raw, lot_number: 'KDA-1', quantity_received: 10 }] }).expect(200);
  const lot = (await c.api.get('/api/trace/KDA-1')).body.lot;
  assert.equal(lot.owner_customer_name, 'Kunde A');
  const item = (await c.api.get(`/api/items/${raw}`)).body;
  assert.equal(Number(item.avg_cost), 5); // not pulled down by the free customer material
  // same lot number cannot change owner
  await c.api.post('/api/procurement/receipts', { items: [{ item_id: raw, lot_number: 'KDA-1', quantity_received: 1 }] }).expect(400);
});

test('stock value leaves out customer material', async () => {
  const r = (await c.api.get('/api/reports/stock-value')).body;
  const row = r.rows.find((x) => x.item_code === 'ROHR-30');
  assert.equal(Number(row.quantity), 20);
  assert.equal(row.customer_owned, 10);
  assert.equal(row.value, 50); // only our 10 × 5 €
});

test("another customer's order never uses customer A's material", async () => {
  const order = await prodOrderFor(custB, 4);
  await c.api.post('/api/production/results', { order_id: order, qty_ok: 4 }).expect(201);
  assert.equal(await lotQty('KDA-1'), 10);
  assert.equal(await lotQty('OWN-1'), 6);
});

test("customer A's order uses its material first, at no material cost", async () => {
  const order = await prodOrderFor(custA, 3);
  await c.api.post('/api/production/results', { order_id: order, qty_ok: 3 }).expect(201);
  assert.equal(await lotQty('KDA-1'), 7);
  assert.equal(await lotQty('OWN-1'), 6);
  const cost = (await c.api.get(`/api/reports/costing/${order}`)).body;
  assert.equal(cost.actual.material, 0);
});
