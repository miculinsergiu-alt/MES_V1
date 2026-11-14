/**
 * Stock with batches: purchase lots, moving average cost, FIFO material
 * consumption, finished goods into production lots, deliveries from lots,
 * and the negative-stock rule.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let machine; let raw; let fg; let bomId; let supplier; let customer; let orderId;

const stockOf = async (itemId) => (await c.api.get('/api/stock')).body.find((s) => s.item_id === itemId);
const lot = async (n) => (await c.api.get(`/api/inventory/traceability/${n}`)).body;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('STOCK');
  machine = await t.createMachine(c.api, 'Laser');
  raw = await t.createItem(c.api, 'RAW', 'raw_material', { acquisition_cost: 2 });
  fg = await t.createItem(c.api, 'FG', 'finished_good', { unit_price: 20 });
  bomId = (await c.api.post('/api/boms', { parent_item_id: fg, name: 'FG BOM', tree: [{ item_id: raw, quantity: 1, node_type: 'component' }] })).body.id;
  supplier = (await c.api.post('/api/suppliers', { name: 'Lieferant GmbH' })).body.id;
  await c.api.put('/api/settings/company', {
    legal_name: 'STOCK GmbH', street: 'Weg 1', postal_code: '10115', city: 'Berlin', vat_id: 'DE123456789',
  }).expect(200);
  customer = (await c.api.post('/api/customers', { name: 'Kunde AG', street: 'Str. 1', postal_code: '80331', city: 'München', country: 'DE' })).body;
});
after(t.teardown);

describe('settings', () => {
  test('negative-stock rule, labour rate and machine hourly rate can be set', async () => {
    const s = await c.api.put('/api/settings/company', { negative_stock: 'allow', labor_rate: '45.50' });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.negative_stock, 'allow');
    assert.equal(s.body.labor_rate, 45.5);
    assert.equal((await c.api.put('/api/settings/company', { negative_stock: 'sometimes' })).status, 400);

    await c.api.put(`/api/machines/${machine}`, { hourly_rate: 80 }).expect(200);
    const m = (await c.api.get('/api/machines')).body.find((x) => x.id === machine);
    assert.equal(m.hourly_rate, 80);
  });
});

describe('receipts and average cost', () => {
  test('receipts create lots and a moving average cost', async () => {
    const po = await c.api.post('/api/procurement/purchase-orders', {
      supplier_id: supplier, items: [{ item_id: raw, quantity_ordered: 10, unit_price: 3 }],
    });
    await c.api.post('/api/procurement/receipts', { po_id: po.body.id, items: [{ item_id: raw, lot_number: 'R1', quantity_received: 10 }] }).expect(200);
    // Without a purchase order the item's purchase cost (2) is used
    await c.api.post('/api/procurement/receipts', { items: [{ item_id: raw, lot_number: 'R2', quantity_received: 10 }] }).expect(200);

    assert.equal((await stockOf(raw)).quantity, 20);
    const item = (await c.api.get(`/api/items/${raw}`)).body;
    assert.equal(Number(item.avg_cost ?? item.item?.avg_cost), 2.5); // (10×3 + 10×2) / 20
    const r1 = await lot('R1');
    assert.equal(r1.lot.source_type, 'receipt');
    assert.equal(r1.transactions[0].unit_cost, 3);
  });
});

describe('production', () => {
  test('material is consumed first-in-first-out and finished goods go into a production lot', async () => {
    const res = await c.api.post('/api/orders', {
      orders: [{ machine_id: machine, item_id: fg, bom_id: bomId, quantity: 12, planned_start: '2030-01-05 08:00' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    orderId = res.body.created[0].id;

    const r = await c.api.post('/api/production/results', { order_id: orderId, qty_ok: 12 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.lot_number, `FA-${orderId}`);

    assert.equal((await lot('R1')).lot.quantity, 0);
    assert.equal((await lot('R2')).lot.quantity, 8);
    assert.equal((await stockOf(raw)).quantity, 8);

    const fa = await lot(`FA-${orderId}`);
    assert.equal(fa.lot.quantity, 12);
    assert.equal(fa.lot.source_type, 'production');
    assert.equal(fa.lot.production_order_id, orderId);
    assert.equal((await stockOf(fg)).quantity, 12);
  });
});

describe('deliveries', () => {
  const deliver = async (qty) => {
    const d = await c.api.post('/api/sales', { doc_type: 'delivery', customer_id: customer.id, lines: [{ item_id: fg, quantity: qty }] });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    return c.api.post(`/api/sales/${d.body.id}/issue`, {});
  };

  test('a delivery takes goods from the production lot', async () => {
    const res = await deliver(5);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await lot(`FA-${orderId}`)).lot.quantity, 7);
    assert.equal((await stockOf(fg)).quantity, 7);
  });

  test('with "block", a delivery beyond stock is refused and nothing is booked', async () => {
    await c.api.put('/api/settings/company', { negative_stock: 'block' }).expect(200);
    const res = await deliver(50);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INSUFFICIENT_STOCK');
    assert.equal(res.body.available, 7);
    assert.equal((await stockOf(fg)).quantity, 7);
  });

  test('with "allow", stock may go negative', async () => {
    await c.api.put('/api/settings/company', { negative_stock: 'allow' }).expect(200);
    const res = await deliver(10);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await stockOf(fg)).quantity, -3);
    assert.equal((await lot(`FA-${orderId}`)).lot.quantity, 0);
  });
});

describe('batch traceability', () => {
  test('backward: a production lot leads to its material lots and supplier', async () => {
    const res = await c.api.get(`/api/trace/FA-${orderId}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const b = res.body.backward;
    assert.equal(b.origin.type, 'production');
    assert.equal(b.origin.order.id, orderId);
    assert.deepEqual(b.materials.map((m) => [m.lot.lot_number, m.quantity]), [['R1', 10], ['R2', 2]]);
    assert.equal(b.materials[0].origin.receipts[0].supplier_name, 'Lieferant GmbH');
    assert.deepEqual(res.body.suppliers.map((s) => s.lot_number).sort(), ['R1', 'R2']);
  });

  test('forward: a purchase lot leads to the production order and the customer deliveries', async () => {
    const res = await c.api.get('/api/trace/R1');
    assert.equal(res.status, 200);
    const use = res.body.forward.usage;
    assert.equal(use.length, 1);
    assert.equal(use[0].type, 'production');
    assert.equal(use[0].quantity, 10);
    assert.equal(use[0].produced[0].lot.lot_number, `FA-${orderId}`);
    // Two deliveries left the production lot (5 and 7 of the 10 delivered from it)
    assert.equal(res.body.customers.length, 2);
    assert.ok(res.body.customers.every((x) => x.customer_name === 'Kunde AG'));
    assert.deepEqual(res.body.customers.map((x) => x.quantity).sort((a, b) => a - b), [5, 7]);
  });

  test('lot search finds lots by number, item and customer', async () => {
    assert.ok((await c.api.get('/api/trace?q=R1')).body.some((l) => l.lot_number === 'R1'));
    assert.ok((await c.api.get('/api/trace?q=FG')).body.some((l) => l.lot_number === `FA-${orderId}`));
    assert.deepEqual((await c.api.get('/api/trace?q=Kunde')).body.map((l) => l.lot_number), [`FA-${orderId}`]);
    assert.equal((await c.api.get('/api/trace/NOPE')).status, 404);
  });
});
