/**
 * Vorkalkulation: price tiers from BOM, routing (setup + cycle time × rates),
 * outside processing, surcharges; saved snapshot on a quote line; quoted vs.
 * actual in the costing; won/lost reasons and win rate.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let mill; let raw; let part; let supplier; let customer; let calcId; let quoteId;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('CALC');
  mill = await t.createMachine(c.api, 'DMG Fräse');
  await c.api.put(`/api/machines/${mill}`, { hourly_rate: 90 }).expect(200);
  await c.api.put('/api/settings/company', {
    legal_name: 'Calc GmbH', street: 'Weg 1', postal_code: '10115', city: 'Berlin', vat_id: 'DE123456789',
    labor_rate: 40, calc_material_surcharge: 10, calc_overhead: 20, calc_margin: 15,
  }).expect(200);
  raw = await t.createItem(c.api, 'ALU-RD50', 'raw_material', { acquisition_cost: 4 });
  part = await t.createItem(c.api, 'FLANSCH-50', 'finished_good', { unit_price: 0 });
  await c.api.post('/api/boms', { parent_item_id: part, name: 'Flansch', tree: [{ item_id: raw, quantity: 0.5, node_type: 'component' }] }).expect(201);
  supplier = (await c.api.post('/api/suppliers', { name: 'Härterei Nord' })).body.id;
  await c.api.put(`/api/items/${part}`, {
    routes: [
      { machine_id: mill, setup_time_min: 60, process_time_min: 3 },
      { step_type: 'external', supplier_id: supplier, external_days: 4, external_price: 0.5, external_min_charge: 40, notes: 'Härten' },
    ],
  }).expect(200);
  customer = (await c.api.post('/api/customers', { name: 'Kunde KG', street: 'Str. 1', postal_code: '80331', city: 'München' })).body;
});
after(t.teardown);

test('inputs come from BOM, routing and rates', async () => {
  const res = await c.api.get(`/api/quote-calc/inputs/${part}`).expect(200);
  assert.equal(res.body.materials[0].qty_per_piece, 0.5);
  assert.equal(res.body.materials[0].unit_cost, 4);
  assert.equal(res.body.steps[0].hourly_rate, 90);
  assert.equal(res.body.rates.labor_rate, 40);
  assert.deepEqual(res.body.warnings, []);
});

test('price per piece falls with quantity because setup is spread', async () => {
  const res = await c.api.post('/api/quote-calc/preview', { item_id: part, quantities: [100, 10] }).expect(200);
  const [ten, hundred] = res.body.tiers;
  assert.equal(ten.quantity, 10);
  // qty 10: material 10×0.5×4 = 20, +10% = 2; hours (60 + 30)/60 = 1.5 → machine 135, labour 60;
  // external max(5, 40) = 40; overhead 20% × 195 = 39; cost = 20+2+135+60+40+39 = 296; margin 15% = 44.40
  assert.equal(ten.material, 20);
  assert.equal(ten.machine, 135);
  assert.equal(ten.labour, 60);
  assert.equal(ten.external, 40);
  assert.equal(ten.overhead, 39);
  assert.equal(ten.cost, 296);
  assert.equal(ten.net, 340.4);
  assert.equal(ten.price_per_piece, 34.04);
  assert.ok(hundred.price_per_piece < ten.price_per_piece);
});

test('overrides (e.g. a special margin) change only this calculation', async () => {
  const res = await c.api.post('/api/quote-calc/preview', { item_id: part, quantities: [10], overrides: { rates: { margin: 0 } } }).expect(200);
  assert.equal(res.body.tiers[0].net, 296);
  const again = await c.api.post('/api/quote-calc/preview', { item_id: part, quantities: [10] });
  assert.equal(again.body.tiers[0].net, 340.4);
});

test('a saved calculation prices a quote line and travels to the order', async () => {
  const saved = await c.api.post('/api/quote-calc', { item_id: part, quantities: [10, 50], customer_id: customer.id }).expect(201);
  calcId = saved.body.id;
  const tier = saved.body.tiers[0];
  const q = await c.api.post('/api/sales', {
    doc_type: 'quote', customer_id: customer.id,
    lines: [{ item_id: part, quantity: 10, unit_price: tier.price_per_piece, calculation_id: calcId }],
  });
  assert.equal(q.status, 201, JSON.stringify(q.body));
  quoteId = q.body.id;
  assert.equal(q.body.lines[0].calculation_id, calcId);
  await c.api.post(`/api/sales/${quoteId}/issue`, {}).expect(200);
  const order = await c.api.post(`/api/sales/${quoteId}/convert`, { target: 'order' });
  assert.equal(order.body.lines[0].calculation_id, calcId);
  await c.api.post(`/api/sales/${order.body.id}/issue`, { create_production: { planned_start: '2030-05-02 06:00' } }).expect(200);
  const prod = (await c.api.get('/api/sales/' + order.body.id)).body.lines[0].production_order_id;
  const cost = (await c.api.get(`/api/reports/costing/${prod}`)).body;
  assert.equal(cost.quoted.calculation_id, calcId);
  assert.equal(cost.quoted.price_per_piece, 34.04);
  assert.equal(cost.planned.external, 40);
});

test('won / lost with reason, and the win rate', async () => {
  const lostQuote = await c.api.post('/api/sales', { doc_type: 'quote', customer_id: customer.id, lines: [{ description: 'Sonderteil', quantity: 1, unit_price: 500 }] });
  await c.api.post(`/api/sales/${lostQuote.body.id}/outcome`, {}).expect(404);
  await c.api.post(`/api/quote-calc/outcome/${lostQuote.body.id}`, { outcome: 'lost', reason: 'price' }).expect(400); // not issued
  await c.api.post(`/api/sales/${lostQuote.body.id}/issue`, {}).expect(200);
  await c.api.post(`/api/quote-calc/outcome/${lostQuote.body.id}`, { outcome: 'lost' }).expect(400); // reason required
  await c.api.post(`/api/quote-calc/outcome/${lostQuote.body.id}`, { outcome: 'lost', reason: 'price', competitor: 'Billig GmbH', competitor_price: 380 }).expect(200);
  assert.equal((await c.api.get(`/api/sales/${lostQuote.body.id}`)).body.status, 'declined');
  const stats = (await c.api.get('/api/quote-calc/stats')).body;
  assert.equal(stats.won, 1);
  assert.equal(stats.lost, 1);
  assert.equal(stats.win_rate, 50);
  assert.deepEqual(stats.loss_reasons, { price: 1 });
});
