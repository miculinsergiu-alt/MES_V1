/**
 * End-to-end flow: purchase -> goods receipt -> BOM -> production order (MRP)
 * -> operator work -> results -> stock consumption.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let shiftLead; let operator;
let machine; let machine2; let steel; let bolt; let product; let supplier; let bomId;

const stockOf = async (itemId) => (await c.api.get('/api/stock')).body.find((s) => s.item_id === itemId);

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('FLOW');
  shiftLead = await t.userClient(c.api, 'FLOW', 'SHR1', 'shift_responsible');
  operator = await t.userClient(c.api, 'FLOW', 'OPR1', 'operator');
  machine = await t.createMachine(c.api, 'Laser');
  machine2 = await t.createMachine(c.api, 'Bending');
  steel = await t.createItem(c.api, 'STEEL', 'raw_material', { acquisition_cost: 2, uom: 'kg' });
  bolt = await t.createItem(c.api, 'BOLT', 'raw_material', { acquisition_cost: 0.1 });
  product = await t.createItem(c.api, 'BRACKET', 'finished_good');
  supplier = (await c.api.post('/api/suppliers', { name: 'Stahl AG', vat_number: 'de 123 456 789' })).body.id;
});
after(t.teardown);

describe('procurement', () => {
  test('supplier VAT number is normalised', async () => {
    const s = (await c.api.get('/api/suppliers')).body.find((x) => x.id === supplier);
    assert.equal(s.vat_number, 'DE123456789');
  });

  test('VAT number can be changed later (was ignored before)', async () => {
    await c.api.put(`/api/suppliers/${supplier}`, { vat_number: 'ATU12345678' }).expect(200);
    const s = (await c.api.get('/api/suppliers')).body.find((x) => x.id === supplier);
    assert.equal(s.vat_number, 'ATU12345678');
    assert.equal(s.name, 'Stahl AG');
  });

  test('purchase order and partial + full goods receipt update stock and PO status', async () => {
    const po = await c.api.post('/api/procurement/purchase-orders', {
      supplier_id: supplier, expected_date: '2030-01-10',
      items: [{ item_id: steel, quantity_ordered: '100', unit_price: '2.5' }, { item_id: bolt, quantity_ordered: 50 }],
    });
    assert.equal(po.status, 200);

    await c.api.post('/api/procurement/receipts', {
      po_id: String(po.body.id), document_reference: 'LS-1',
      items: [{ item_id: steel, lot_number: 'L-STEEL-1', quantity_received: 60, location_id: '' }],
    }).expect(200);
    let pos = (await c.api.get('/api/procurement/purchase-orders')).body;
    assert.equal(pos.find((p) => p.id === po.body.id).status, 'partial');

    await c.api.post('/api/procurement/receipts', {
      po_id: po.body.id,
      items: [
        { item_id: steel, lot_number: 'L-STEEL-2', quantity_received: 40 },
        { item_id: bolt, lot_number: 'L-BOLT-1', quantity_received: 50 },
      ],
    }).expect(200);
    pos = (await c.api.get('/api/procurement/purchase-orders')).body;
    assert.equal(pos.find((p) => p.id === po.body.id).status, 'received');
    assert.equal((await stockOf(steel)).quantity, 100);
    assert.equal((await stockOf(bolt)).quantity, 50);

    const trace = await c.api.get('/api/inventory/traceability/L-STEEL-1');
    assert.equal(trace.status, 200);
    assert.equal(trace.body.transactions.length, 1);
  });

  test('a failing receipt line rolls back the whole receipt', async () => {
    const before = (await stockOf(steel)).quantity;
    const res = await c.api.post('/api/procurement/receipts', {
      items: [
        { item_id: steel, lot_number: 'L-STEEL-3', quantity_received: 10 },
        { item_id: bolt, lot_number: 'L-STEEL-1', quantity_received: 5 }, // lot number of another item
      ],
    });
    assert.equal(res.status, 400);
    assert.equal((await stockOf(steel)).quantity, before);
    assert.equal((await c.api.get('/api/inventory/traceability/L-STEEL-3')).status, 404);
  });

  test('quarantined goods can be scrapped and leave stock', async () => {
    await c.api.post('/api/procurement/receipts', {
      items: [{ item_id: bolt, lot_number: 'L-BOLT-Q', quantity_received: 10, quality_status: 'quarantine' }],
    }).expect(200);
    const open = (await c.api.get('/api/quality/quarantine')).body;
    assert.equal(open.length, 1);
    await c.api.put(`/api/quality/quarantine/${open[0].id}/resolve`, { decision: 'scrapped', decision_by: 999 }).expect(200);
    assert.equal((await stockOf(bolt)).quantity, 50);
    // A decided case cannot be decided again
    assert.equal((await c.api.put(`/api/quality/quarantine/${open[0].id}/resolve`, { decision: 'released' })).status, 409);
  });
});

describe('production order with MRP', () => {
  test('BOM can be created as a tree', async () => {
    const res = await c.api.post('/api/boms', {
      parent_item_id: product, name: 'Bracket BOM',
      tree: [
        { item_id: steel, quantity: 2, node_type: 'component' },
        { item_id: bolt, quantity: 4, node_type: 'component' },
      ],
    });
    assert.equal(res.status, 201);
    bomId = res.body.id;
    const tree = await c.api.get(`/api/boms/${bomId}/tree`);
    assert.equal(tree.body.tree.length, 2);
  });

  let orderId;
  test('creating an order reserves material and recommends purchases for the shortfall', async () => {
    // 20 brackets need 40 kg steel (100 in stock) and 80 bolts (50 in stock -> 30 short)
    const res = await c.api.post('/api/orders', {
      orders: [{ machine_id: machine, item_id: product, bom_id: bomId, quantity: 20,
        planned_start: '2030-02-01T08:00', planned_end: '2030-02-01T12:00' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    orderId = res.body.created[0].id;
    assert.equal(res.body.created[0].planned_start, '2030-02-01 08:00:00');

    assert.equal((await stockOf(steel)).allocated_quantity, 40);
    assert.equal((await stockOf(bolt)).allocated_quantity, 50);
    const recs = (await c.api.get('/api/procurement/recommendations')).body;
    assert.equal(recs.length, 1);
    assert.equal(recs[0].item_id, bolt);
    assert.equal(recs[0].recommended_qty, 30);
  });

  test('a recommendation can be converted into a purchase order', async () => {
    const rec = (await c.api.get('/api/procurement/recommendations')).body[0];
    const res = await c.api.post(`/api/procurement/recommendations/${rec.id}/convert`, { supplier_id: supplier });
    assert.equal(res.status, 200);
    assert.equal((await c.api.get('/api/procurement/recommendations')).body.length, 0);
    assert.equal((await c.api.post(`/api/procurement/recommendations/${rec.id}/convert`, { supplier_id: supplier })).status, 409);
  });

  test('a second order on the same machine is scheduled after the first (no overlap)', async () => {
    const res = await c.api.post('/api/orders', {
      orders: [{ machine_id: machine, product_name: 'Rush job', quantity: 1,
        planned_start: '2030-02-01 09:00', planned_end: '2030-02-01 10:00' }],
    });
    assert.equal(res.body.created[0].planned_start, '2030-02-01 12:00:00');
    assert.equal(res.body.created[0].planned_end, '2030-02-01 13:00:00');
  });

  test('a delay pushes the following orders on the machine', async () => {
    await c.api.post(`/api/orders/${orderId}/delay`, { delay_minutes: 30, reason: 'Machine fault', source: 'system' }).expect(200);
    const orders = (await c.api.get(`/api/orders?machine_id=${machine}`)).body;
    assert.equal(orders[0].planned_end, '2030-02-01 12:30:00');
    assert.equal(orders[1].planned_start, '2030-02-01 12:30:00');
    assert.equal(orders[1].planned_end, '2030-02-01 13:30:00');
    const gantt = (await c.api.get('/api/orders/gantt?date_from=2030-02-01&date_to=2030-02-02')).body;
    assert.equal(gantt.find((o) => o.id === orderId).delays.length, 1);
  });

  test('operator work and results consume reserved material and finish the order', async () => {
    const alloc = await shiftLead.api.post('/api/production/allocations', {
      order_id: orderId, operator_id: operator.id, machine_id: machine,
      start_time: '2030-02-01 08:00', end_time: '2030-02-01 12:30', phase: 'working',
    });
    assert.equal(alloc.status, 201, JSON.stringify(alloc.body));

    await operator.api.post('/api/production/actions', { allocation_id: alloc.body.id, action_type: 'working_start' }).expect(201);

    const reasons = (await c.api.get('/api/production/defect-reasons')).body;
    const res = await operator.api.post('/api/production/results', {
      order_id: orderId, qty_ok: 18, qty_fail: 2, defects: [{ reason_id: reasons[0].id, quantity: 2 }],
    });
    assert.equal(res.status, 201);

    assert.equal((await stockOf(steel)).quantity, 60); // 100 - 20*2
    assert.equal((await stockOf(steel)).allocated_quantity, 0);
    assert.equal((await stockOf(bolt)).quantity, -30); // only 50 were in stock; shortfall shows as negative
    const order = (await c.api.get(`/api/orders/${orderId}`)).body;
    assert.equal(order.status, 'done');
  });

  test('an operator cannot act on another operator\'s task', async () => {
    const other = await t.userClient(c.api, 'FLOW', 'OPR2', 'operator');
    const allocs = (await c.api.get(`/api/production/allocations?order_id=${orderId}`)).body;
    const res = await other.api.post('/api/production/actions', { allocation_id: allocs[0].id, action_type: 'working_end' });
    assert.equal(res.status, 403);
  });

  test('cancelling an order releases its reserved material', async () => {
    const res = await c.api.post('/api/orders', {
      orders: [{ machine_id: machine, item_id: product, bom_id: bomId, quantity: 5, planned_start: '2030-03-01 08:00' }],
    });
    const id = res.body.created[0].id;
    assert.equal((await stockOf(steel)).allocated_quantity, 10);
    await c.api.delete(`/api/orders/${id}`).expect(200);
    assert.equal((await stockOf(steel)).allocated_quantity, 0);
  });

  test('items with a routing are split into one order per step', async () => {
    const routed = await t.createItem(c.api, 'ROUTED', 'finished_good', {
      routes: [{ machine_id: machine2, process_time_min: 10 }, { machine_id: machine2, process_time_min: 5 }],
    });
    const res = await c.api.post('/api/orders', {
      orders: [{ item_id: routed, quantity: 3, planned_start: '2030-04-01 06:00' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [s1, s2] = res.body.created;
    assert.equal(s1.planned_end, '2030-04-01 06:30:00'); // 3 x 10 min
    assert.equal(s2.planned_start, s1.planned_end);
    assert.equal(s2.planned_end, '2030-04-01 06:45:00');
    const chain = (await c.api.get(`/api/orders/${s2.id}/chain`)).body;
    assert.equal(chain.length, 2);
  });
});

describe('validation', () => {
  test('invalid input returns 400 with field details', async () => {
    const res = await c.api.post('/api/orders', { orders: [{ machine_id: machine, product_name: 'x', quantity: -5, planned_start: 'tomorrow' }] });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'BAD_REQUEST');
    assert.ok(res.body.details.some((d) => d.field.includes('quantity')));
  });

  test('non-numeric ids return 400, unknown ids 404', async () => {
    assert.equal((await c.api.get('/api/items/abc')).status, 400);
    assert.equal((await c.api.get('/api/items/999999')).status, 404);
  });

  test('duplicate item codes return 409', async () => {
    const res = await c.api.post('/api/items', { item_code: 'STEEL', name: 'dup', type: 'raw_material' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'DUPLICATE');
  });

  test('unknown API routes return JSON 404', async () => {
    const res = await c.api.get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'NOT_FOUND');
  });

  test('the shift schedule route is reachable (was shadowed by /:id before)', async () => {
    const res = await c.api.get('/api/shifts/schedule');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });
});

describe('VAT number parsing', () => {
  const { parseVatId } = require('../routes/suppliers');
  test('normalises and maps Greece to EL', () => {
    assert.deepEqual(parseVatId('de 123.456.789'), { country: 'DE', number: '123456789' });
    assert.deepEqual(parseVatId('GR123456789'), { country: 'EL', number: '123456789' });
  });
  test('rejects non-EU and malformed numbers', () => {
    assert.equal(parseVatId('12345'), null);
    assert.equal(parseVatId('US123456789'), null);
    assert.equal(parseVatId('DE'), null);
  });
});
