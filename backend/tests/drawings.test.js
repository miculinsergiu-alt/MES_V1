/**
 * Drawings / NC programs with revision index on production orders:
 * the order freezes the revision; a newer revision is flagged at the machine;
 * the planner can adopt it; the frozen revision cannot be deleted.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let mill; let lathe; let item; let rootId; let stepId; let revA;
const pdf = Buffer.from('%PDF-1.4 drawing').toString('base64');
const upload = (kind, revision, filename) => c.api.post('/api/attachments', { owner_type: 'item', owner_id: item, kind, revision, filename, content_base64: kind === 'drawing' ? pdf : Buffer.from('G0 X0 Y0\nM30\n').toString('base64') });

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('DRAW');
  mill = await t.createMachine(c.api, 'Fräse');
  lathe = await t.createMachine(c.api, 'Drehe');
  item = await t.createItem(c.api, 'WELLE-7', 'finished_good');
  await c.api.put(`/api/items/${item}`, { routes: [{ machine_id: lathe, process_time_min: 2 }, { machine_id: mill, process_time_min: 3 }] }).expect(200);
  revA = (await upload('drawing', 'A', 'welle-7-A.pdf').expect(201)).body;
  await upload('nc_program', '01', 'O7001.nc').expect(201);
  const res = await c.api.post('/api/orders', { orders: [{ item_id: item, quantity: 5, planned_start: '2030-06-03 06:00' }] }).expect(201);
  rootId = res.body.created[0].id;
  stepId = res.body.created[1].id;
});
after(t.teardown);

test('a new order is planned with the current drawing and NC program; all steps share them', async () => {
  const docs = (await c.api.get(`/api/orders/${stepId}/documents`).expect(200)).body;
  assert.equal(docs.drawing.file.revision, 'A');
  assert.equal(docs.drawing.outdated, false);
  assert.equal(docs.nc_program.file.filename, 'O7001.nc');
});

test('an operator sees the drawing and is warned about a newer revision', async () => {
  await upload('drawing', 'B', 'welle-7-B.pdf').expect(201);
  const op = await t.userClient(c.api, 'DRAW', 'OP7', 'operator');
  const docs = (await op.api.get(`/api/orders/${rootId}/documents`).expect(200)).body;
  assert.equal(docs.drawing.file.revision, 'A'); // what the order was planned with
  assert.equal(docs.drawing.current_revision, 'B');
  assert.equal(docs.drawing.outdated, true);
  await op.api.get(`/api/attachments/${docs.drawing.file.id}/file`).expect(200);
  await op.api.post(`/api/orders/${rootId}/adopt-revision`, {}).expect(403);
});

test('the revision an order uses cannot be deleted; the planner can adopt the new one', async () => {
  await c.api.delete(`/api/attachments/${revA.id}`).expect(400);
  await c.api.post(`/api/orders/${stepId}/adopt-revision`, {}).expect(200);
  const docs = (await c.api.get(`/api/orders/${rootId}/documents`)).body;
  assert.equal(docs.drawing.file.revision, 'B');
  assert.equal(docs.drawing.outdated, false);
  await c.api.delete(`/api/attachments/${revA.id}`).expect(200); // no longer used
});
