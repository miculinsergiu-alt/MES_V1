/**
 * Real-time events reach only users of the same company, and only after login.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { io: connect } = require('socket.io-client');
const t = require('./helpers');
const { initSocket } = require('../services/socket');

let server; let url; let a; let b;

before(async () => {
  await t.setup();
  server = createServer(t.app);
  initSocket(server);
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
  a = await t.companyWithAdmin('RTA');
  b = await t.companyWithAdmin('RTB');
});

after(async () => {
  await new Promise((r) => server.close(r));
  await t.teardown();
});

function socketFor(token) {
  return new Promise((resolve, reject) => {
    const s = connect(url, { transports: ['websocket'], auth: token ? { token } : undefined, reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => { s.close(); reject(e); });
  });
}

test('connections without a valid token are refused', async () => {
  await assert.rejects(socketFor(null), /unauthorized/);
  await assert.rejects(socketFor('not-a-token'), /unauthorized/);
});

test('events are delivered to the own company only', async () => {
  const sa = await socketFor(a.token);
  const sb = await socketFor(b.token);
  const receivedA = []; const receivedB = [];
  sa.on('production:results', (d) => receivedA.push(d));
  sb.on('production:results', (d) => receivedB.push(d));

  const machine = await t.createMachine(a.api);
  const order = await a.api.post('/api/orders', { orders: [{ machine_id: machine, product_name: 'P', quantity: 5, planned_start: '2030-01-01 08:00' }] });
  await a.api.post('/api/production/results', { order_id: order.body.created[0].id, qty_ok: 1 }).expect(201);

  await new Promise((r) => setTimeout(r, 300));
  assert.equal(receivedA.length, 1);
  assert.equal(receivedB.length, 0);
  sa.close(); sb.close();
});

test('no event is sent when the change is rolled back', async () => {
  const sa = await socketFor(a.token);
  const received = [];
  sa.on('production:results', (d) => received.push(d));
  // Order does not exist -> 404 -> transaction rolled back -> no broadcast
  await a.api.post('/api/production/results', { order_id: 999999, qty_ok: 1 }).expect(404);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(received.length, 0);
  sa.close();
});
