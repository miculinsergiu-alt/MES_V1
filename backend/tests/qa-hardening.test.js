/**
 * Edge cases found in the QA pass (2026-11-14): out-of-range ids, impossible
 * dates and times, receipts of items not on the PO, transfers, payment reversals, BOM quantities.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let acc; let steel; let bolt; let prod; let loc1; let loc2; let sup;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('QAH');
  acc = await t.userClient(c.api, 'QAH', 'ACC1', 'accounting');
  await c.api.put('/api/settings/company', { legal_name: 'QAH GmbH', street: 'Hauptstr. 1', postal_code: '10115', city: 'Berlin', vat_id: 'DE123456789' });
  steel = await t.createItem(c.api, 'STEEL', 'raw_material', { acquisition_cost: 2 });
  bolt = await t.createItem(c.api, 'BOLT', 'raw_material', { acquisition_cost: 1 });
  prod = await t.createItem(c.api, 'PROD', 'finished_good');
  const wh = (await c.api.post('/api/warehousing/warehouses', { name: 'WH1', type: 'central' })).body;
  loc1 = (await c.api.post('/api/warehousing/locations', { warehouse_id: wh.id, zone: 'A', shelf: '1', bin: '1', barcode: 'L1' })).body;
  loc2 = (await c.api.post('/api/warehousing/locations', { warehouse_id: wh.id, zone: 'A', shelf: '1', bin: '2', barcode: 'L2' })).body;
  sup = (await c.api.post('/api/suppliers', { name: 'Sup' })).body.id;
});
after(t.teardown);

test('ids beyond the INTEGER range are a 400, not a server error', async () => {
  for (const url of ['/api/items/2147483648', '/api/sales/2147483648', '/api/warehousing/locations/2147483648', '/api/orders/99999999999']) {
    assert.equal((await c.api.get(url)).status, 400, url);
  }
});

test('impossible dates and times are rejected', async () => {
  const lead = await t.userClient(c.api, 'QAH', 'L1', 'shift_responsible');
  assert.equal((await c.api.post('/api/shifts', { name: 'X', shift_responsible_id: lead.id, start_time: '25:99', end_time: '06:00' })).status, 400);
  assert.equal((await c.api.post('/api/shifts', { name: 'Nacht', shift_responsible_id: lead.id, start_time: '22:00', end_time: '06:00' })).status, 201);
  const po = await c.api.post('/api/procurement/purchase-orders', { supplier_id: sup, expected_date: '2030-02-31', items: [{ item_id: steel, quantity_ordered: 1, unit_price: 1 }] });
  assert.equal(po.status, 400);
});

test('goods receipt refuses items that are not on the purchase order', async () => {
  const po = (await c.api.post('/api/procurement/purchase-orders', { supplier_id: sup, items: [{ item_id: steel, quantity_ordered: 100, unit_price: 2 }] })).body;
  const bad = await c.api.post('/api/procurement/receipts', { po_id: po.id, items: [{ item_id: bolt, lot_number: 'LB', quantity_received: 7, location_id: loc1.id }] });
  assert.equal(bad.status, 400);
  assert.equal((await c.api.get('/api/stock')).body.find((s) => s.item_id === bolt)?.quantity ?? 0, 0);
  await c.api.post('/api/procurement/receipts', { po_id: po.id, items: [{ item_id: steel, lot_number: 'LOT-S', quantity_received: 100, location_id: loc1.id }] }).expect(200);
});

test('transfers check source location and available stock', async () => {
  const tr = (items) => c.api.post('/api/inventory/transfers', { items });
  assert.equal((await tr([{ item_id: steel, lot_number: 'LOT-S', quantity: 1, from_location_id: loc1.id, to_location_id: loc1.id }])).status, 400);
  assert.equal((await tr([{ item_id: steel, lot_number: 'LOT-S', quantity: 1, from_location_id: loc2.id, to_location_id: loc1.id }])).status, 400);
  assert.equal((await tr([{ item_id: steel, quantity: 99999, from_location_id: loc1.id, to_location_id: loc2.id }])).status, 400);
  assert.equal((await tr([{ item_id: steel, lot_number: 'LOT-S', quantity: 100, from_location_id: loc1.id, to_location_id: loc2.id }])).status, 200);
});

test('a payment reversal cannot exceed what was paid', async () => {
  const cust = (await c.api.post('/api/customers', { name: 'Kunde', street: 'Weg 2', postal_code: '80331', city: 'München', country: 'DE' })).body;
  const inv = (await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: cust.id, lines: [{ description: 'x', quantity: 1, unit_price: 100 }] })).body;
  await c.api.post(`/api/sales/${inv.id}/issue`, {}).expect(200);
  assert.equal((await acc.api.post(`/api/sales/${inv.id}/payments`, { payment_date: '2030-07-01', amount: -10 })).status, 400);
  await acc.api.post(`/api/sales/${inv.id}/payments`, { payment_date: '2030-07-01', amount: 50 }).expect(201);
  assert.equal((await acc.api.post(`/api/sales/${inv.id}/payments`, { payment_date: '2030-07-02', amount: -60 })).status, 400);
  const r = await acc.api.post(`/api/sales/${inv.id}/payments`, { payment_date: '2030-07-02', amount: -50 });
  assert.equal(r.status, 201);
  assert.equal(Number(r.body.paid_total), 0);
  assert.equal(r.body.status, 'issued');
});

test('BOM components need a quantity above 0', async () => {
  const bad = await c.api.post('/api/boms', { name: 'B0', parent_item_id: prod, tree: [{ item_id: steel, quantity: 0 }] });
  assert.equal(bad.status, 400);
  await c.api.post('/api/boms', { name: 'B1', parent_item_id: prod, tree: [{ item_id: steel, quantity: 2 }] }).expect(201);
});
