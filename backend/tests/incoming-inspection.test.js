/**
 * Incoming inspection: receipts of items with "incoming" characteristics are
 * listed until checked; a NOK value quarantines the received lot.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let op; let raw; let plan;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('WEP');
  op = await t.userClient(c.api, 'WEP', 'OPI', 'operator');
  raw = await t.createItem(c.api, 'RUNDSTAB-40', 'raw_material', { acquisition_cost: 3 });
  plan = (await c.api.put(`/api/quality/plans/${raw}`, { characteristics: [
    { name: 'Durchmesser 40', nominal: 40, lower_limit: 39.8, upper_limit: 40.2, incoming: 1 },
    { name: 'Zeugnis vorhanden', kind: 'attribute', incoming: 1 },
    { name: 'nur Fertigung', nominal: 1, lower_limit: 0, upper_limit: 2 },
  ] }).expect(200)).body;
  await c.api.post('/api/procurement/receipts', { items: [{ item_id: raw, lot_number: 'WE-1', quantity_received: 20 }] }).expect(200);
  await c.api.post('/api/procurement/receipts', { items: [{ item_id: raw, lot_number: 'WE-2', quantity_received: 30 }] }).expect(200);
});
after(t.teardown);

test('open incoming inspections are listed with the incoming characteristics only', async () => {
  const open = (await c.api.get('/api/quality/incoming').expect(200)).body;
  assert.deepEqual(open.map((x) => x.lot_number), ['WE-1', 'WE-2']);
  const insp = (await c.api.get(`/api/quality/receipts/${open[0].id}/inspection`)).body;
  assert.deepEqual(insp.plan.map((p) => p.name), ['Durchmesser 40', 'Zeugnis vorhanden']);
});

test('OK keeps the lot free; NOK quarantines it; operators cannot record incoming checks', async () => {
  const [we1, we2] = (await c.api.get('/api/quality/incoming')).body;
  await op.api.post(`/api/quality/receipts/${we1.id}/measurements`, { values: [{ characteristic_id: plan[0].id, value: 40 }] }).expect(403);
  await c.api.post(`/api/quality/receipts/${we1.id}/measurements`, { values: [{ characteristic_id: plan[2].id, value: 1 }] }).expect(400);
  const ok = (await c.api.post(`/api/quality/receipts/${we1.id}/measurements`, { values: [{ characteristic_id: plan[0].id, value: 40.1 }, { characteristic_id: plan[1].id, ok: true }] }).expect(201)).body;
  assert.equal(ok.quarantine, false);
  const nok = (await c.api.post(`/api/quality/receipts/${we2.id}/measurements`, { values: [{ characteristic_id: plan[0].id, value: 40.5 }, { characteristic_id: plan[1].id, ok: true }] }).expect(201)).body;
  assert.equal(nok.quarantine, true);
  const q = (await c.api.get('/api/quality/quarantine')).body;
  assert.deepEqual(q.map((x) => x.lot_number), ['WE-2']);
  assert.equal((await c.api.get('/api/quality/incoming')).body.length, 0);
});
