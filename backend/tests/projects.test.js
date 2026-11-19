/**
 * Projects: link documents, production and purchases; revenue, cost, margin,
 * budget; production orders of a linked order confirmation count automatically.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let other; let machine; let part; let customer; let supplier; let raw; let project; let orderDoc;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('PROJ');
  other = await t.companyWithAdmin('PROJ2');
  machine = await t.createMachine(c.api, 'Schweißplatz');
  await c.api.put(`/api/machines/${machine}`, { hourly_rate: 60 }).expect(200);
  await c.api.put('/api/settings/company', { legal_name: 'Proj GmbH', street: 'Weg 1', postal_code: '10115', city: 'Berlin', vat_id: 'DE123456789', iban: 'DE89370400440532013000' }).expect(200);
  raw = await t.createItem(c.api, 'BLECH', 'raw_material', { acquisition_cost: 10 });
  part = await t.createItem(c.api, 'GESTELL', 'finished_good', { unit_price: 900 });
  await c.api.put(`/api/items/${part}`, { routes: [{ machine_id: machine, process_time_min: 120 }] }).expect(200);
  customer = (await c.api.post('/api/customers', { name: 'Anlagenbau KG', street: 'Str. 1', postal_code: '80331', city: 'München' })).body;
  supplier = (await c.api.post('/api/suppliers', { name: 'Normteile GmbH' })).body.id;
});
after(t.teardown);

test('create a project with budget', async () => {
  const r = await c.api.post('/api/projects', { name: 'Sondergestell Linie 3', customer_id: customer.id, budget_cost: 1000, budget_revenue: 1800 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  project = r.body;
  assert.match(project.number, /^PR-\d{4}-001$/);
  assert.equal(project.cost.total, 0);
});

test('linked order confirmation brings its production orders; buy-out PO counts as cost', async () => {
  const o = await c.api.post('/api/sales', { doc_type: 'order', customer_id: customer.id, lines: [{ item_id: part, quantity: 2, unit_price: 900 }] });
  orderDoc = o.body.id;
  await c.api.post(`/api/sales/${orderDoc}/issue`, { create_production: { planned_start: '2030-07-01 06:00' } }).expect(200);
  await c.api.post(`/api/projects/${project.id}/links`, { kind: 'sales_document', ref_id: orderDoc }).expect(201);
  const po = (await c.api.post('/api/procurement/purchase-orders', { supplier_id: supplier, items: [{ item_id: raw, quantity_ordered: 10, unit_price: 25 }] })).body;
  const s = (await c.api.post(`/api/projects/${project.id}/links`, { kind: 'purchase_order', ref_id: po.id }).expect(201)).body;
  assert.equal(s.revenue.ordered, 1800);
  assert.equal(s.production.length, 1);
  assert.equal(s.cost.purchases, 250);
  // the same PO cannot belong to two projects
  const p2 = (await c.api.post('/api/projects', { name: 'Anderes' })).body;
  await c.api.post(`/api/projects/${p2.id}/links`, { kind: 'purchase_order', ref_id: po.id }).expect(409);
  await c.api.post(`/api/projects/${project.id}/links`, { kind: 'purchase_order', ref_id: 99999 }).expect(400);
});

test('actual production cost, margin and budget use', async () => {
  const prod = (await c.api.get(`/api/sales/${orderDoc}`)).body.lines[0].production_order_id;
  await c.api.post('/api/production/results', { order_id: prod, qty_ok: 2 }).expect(201);
  const s = (await c.api.get(`/api/projects/${project.id}`)).body;
  assert.ok(s.cost.production > 0);
  assert.equal(s.cost.total, Math.round((s.cost.production + 250) * 100) / 100);
  assert.equal(s.margin, Math.round((1800 - s.cost.total) * 100) / 100);
  assert.equal(s.budget_used_percent, Math.round((s.cost.total / 1000) * 100));
  // unlink
  const after = (await c.api.delete(`/api/projects/${project.id}/links/purchase_order/${s.purchase_orders[0].id}`).expect(200)).body;
  assert.equal(after.cost.purchases, 0);
  await other.api.get(`/api/projects/${project.id}`).expect(404);
});
