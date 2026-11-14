/**
 * Nachkalkulation (planned vs actual cost) and management reports with
 * Excel export: sales & margin, stock value, on-time delivery.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('@e965/xlsx');
const t = require('./helpers');

let c; let operator; let machine; let raw; let fg; let bomId; let orderId; let customer;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('REP');
  operator = await t.userClient(c.api, 'REP', 'OP1', 'operator');
  await c.api.put('/api/settings/company', {
    legal_name: 'REP GmbH', street: 'Weg 1', postal_code: '10115', city: 'Berlin', vat_id: 'DE123456789', labor_rate: 30,
  }).expect(200);
  machine = await t.createMachine(c.api, 'Fräse');
  await c.api.put(`/api/machines/${machine}`, { hourly_rate: 60 }).expect(200);
  raw = await t.createItem(c.api, 'RAW', 'raw_material', { acquisition_cost: 2 });
  fg = await t.createItem(c.api, 'FG', 'finished_good', { unit_price: 50 });
  bomId = (await c.api.post('/api/boms', { parent_item_id: fg, name: 'BOM', tree: [{ item_id: raw, quantity: 2, node_type: 'component' }] })).body.id;
  await c.api.post('/api/procurement/receipts', { items: [{ item_id: raw, lot_number: 'R1', quantity_received: 100 }] }).expect(200);
  customer = (await c.api.post('/api/customers', { name: 'Kunde AG', street: 'Str. 1', postal_code: '80331', city: 'München', country: 'DE' })).body;
});
after(t.teardown);

describe('Nachkalkulation', () => {
  test('planned cost from BOM, schedule and rates', async () => {
    const res = await c.api.post('/api/orders', {
      orders: [{ machine_id: machine, item_id: fg, bom_id: bomId, quantity: 10, planned_start: '2030-01-05 08:00', planned_end: '2030-01-05 10:00' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    orderId = res.body.created[0].id;
    const cost = (await c.api.get(`/api/reports/costing/${orderId}`)).body;
    assert.deepEqual(
      { m: cost.planned.material, mc: cost.planned.machine, l: cost.planned.labour, tot: cost.planned.total, rev: cost.planned.revenue },
      { m: 40, mc: 120, l: 60, tot: 220, rev: 500 }, // 10×2×2 €, 2 h × 60 €, 2 h × 30 €, 10 × 50 €
    );
    assert.equal(cost.actual.total, 0);
  });

  test('actual cost from consumed material and reported times; goods valued at actual cost', async () => {
    const alloc = await c.api.post('/api/production/allocations', {
      order_id: orderId, operator_id: operator.id, machine_id: machine, start_time: '2030-01-05 08:00', end_time: '2030-01-05 10:00', phase: 'working',
    });
    assert.equal(alloc.status, 201, JSON.stringify(alloc.body));
    await operator.api.post('/api/production/actions', { allocation_id: alloc.body.id, action_type: 'working_start' }).expect(201);
    await operator.api.post('/api/production/actions', { allocation_id: alloc.body.id, action_type: 'working_end' }).expect(201);
    // Real run took 3 hours
    await t.db.withContext({ companyId: c.company.id }, async () => {
      await t.db.run("UPDATE operator_actions SET timestamp = '2030-01-05 08:00:00' WHERE action_type = 'working_start'");
      await t.db.run("UPDATE operator_actions SET timestamp = '2030-01-05 11:00:00' WHERE action_type = 'working_end'");
    });
    await operator.api.post('/api/production/results', { order_id: orderId, qty_ok: 9, qty_fail: 1 }).expect(201);

    const cost = (await c.api.get(`/api/reports/costing/${orderId}`)).body;
    assert.equal(cost.actual.material, 40); // 10 pieces (incl. scrap) × 2 kg × 2 €
    assert.equal(cost.actual.machine, 180);
    assert.equal(cost.actual.labour, 90);
    assert.equal(cost.actual.total, 310);
    assert.equal(cost.actual.quantity, 9);
    assert.equal(cost.actual.scrap, 1);
    assert.equal(cost.actual.per_piece, 34.44);
    assert.equal(cost.actual.revenue, 450);
    assert.equal(cost.actual.margin, 140);
    assert.equal(cost.deviation, 90);
    assert.equal(cost.steps[0].actual_machine_hours, 3);

    const item = (await c.api.get(`/api/items/${fg}`)).body;
    assert.equal(Number(item.avg_cost ?? item.item?.avg_cost), 34.44);

    const list = (await c.api.get('/api/reports/costing?from=2030-01-01&to=2030-01-31')).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].actual.total, 310);
  });

  test('without reported times the planned time is used and flagged as estimated', async () => {
    const res = await c.api.post('/api/orders', {
      orders: [{ machine_id: machine, item_id: fg, bom_id: bomId, quantity: 2, planned_start: '2030-01-07 08:00', planned_end: '2030-01-07 09:00' }],
    });
    const id = res.body.created[0].id;
    await c.api.post('/api/production/results', { order_id: id, qty_ok: 2 }).expect(201);
    const cost = (await c.api.get(`/api/reports/costing/${id}`)).body;
    assert.equal(cost.times_estimated, true);
    assert.equal(cost.actual.machine, 60); // 1 h × 60 €
    assert.equal(cost.actual.labour, 30);
  });

  test('operators cannot see costs', async () => {
    assert.equal((await operator.api.get(`/api/reports/costing/${orderId}`)).status, 403);
  });
});

describe('reports', () => {
  test('stock value at current unit cost', async () => {
    const r = (await c.api.get('/api/reports/stock-value')).body;
    const byCode = Object.fromEntries(r.rows.map((x) => [x.item_code, x]));
    assert.equal(byCode.RAW.quantity, 76); // 100 - 20 - 4
    assert.equal(byCode.RAW.value, 152);
    assert.equal(byCode.FG.quantity, 11);
    assert.equal(r.totals.value, Math.round((152 + byCode.FG.value) * 100) / 100);
    assert.ok(byCode.FG.unit_cost > 0);
  });

  test('sales & margin per customer and per item', async () => {
    const inv = await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: customer.id, service_date: '2030-01-06', lines: [
      { item_id: fg, quantity: 4 },
      { description: 'Fracht', quantity: 1, unit_price: 10 },
    ] });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    const issued = await c.api.post(`/api/sales/${inv.body.id}/issue`, {});
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const day = issued.body.document_date;

    const byCustomer = (await c.api.get(`/api/reports/sales?from=${day}&to=${day}`)).body;
    assert.equal(byCustomer.rows.length, 1);
    // Cost of goods = 4 × current moving average cost of FG; freight has no cost
    const avg = Number((await c.api.get(`/api/items/${fg}`)).body.avg_cost);
    assert.equal(avg, 37.0873); // (9 × 34.44 + 2 × 49) / 11
    const cost = Math.round(4 * avg * 100) / 100;
    assert.deepEqual(
      { rev: byCustomer.rows[0].revenue, cost: byCustomer.rows[0].cost, margin: byCustomer.rows[0].margin },
      { rev: 210, cost, margin: Math.round((210 - cost) * 100) / 100 },
    );
    const byItem = (await c.api.get(`/api/reports/sales?from=${day}&to=${day}&group_by=item`)).body;
    assert.equal(byItem.rows.find((x) => x.item_code === 'FG').quantity, 4);
    assert.equal(byItem.totals.revenue, 210);
  });

  test('on-time delivery rate', async () => {
    const mk = async (date) => {
      const o = await c.api.post('/api/sales', { doc_type: 'order', customer_id: customer.id, delivery_date: date, lines: [{ item_id: fg, quantity: 2 }] });
      assert.equal(o.status, 201, JSON.stringify(o.body));
      await c.api.post(`/api/sales/${o.body.id}/issue`, {}).expect(200);
      return o.body.id;
    };
    const onTime = await mk('2030-02-01');
    await mk('2020-02-01'); // never delivered → overdue
    const d = await c.api.post(`/api/sales/${onTime}/convert`, { target: 'delivery' });
    await c.api.post(`/api/sales/${d.body.id}/issue`, {}).expect(200);

    const r = (await c.api.get('/api/reports/on-time-delivery?from=2020-01-01&to=2030-12-31')).body;
    assert.deepEqual(r.rows.map((x) => x.state).sort(), ['on_time', 'overdue']);
    assert.equal(r.totals.rate, 50);
  });

  test('reports export to Excel with German headings', async () => {
    const res = await c.api.get('/api/reports/stock-value?format=xlsx').buffer(true).parse((resp, cb) => {
      const chunks = []; resp.on('data', (x) => chunks.push(x)); resp.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /spreadsheetml/);
    const wb = XLSX.read(res.body, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    assert.equal(rows[0][0], 'Lagerbestandswert');
    assert.deepEqual(rows[2].slice(0, 2), ['Artikelnr.', 'Bezeichnung']);
    assert.equal(rows.length, 5); // title, blank, header, 2 items
  });
});
