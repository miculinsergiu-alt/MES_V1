/**
 * Time clock (PZE): clock in/out, breaks, statutory minimum breaks,
 * corrections with reason, monthly report + CSV, access rules.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');
const { evaluate } = require('../routes/timeclock');

let c; let op; let op2; let other;

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('PZE');
  other = await t.companyWithAdmin('PZE2');
  op = await t.userClient(c.api, 'PZE', 'MA1', 'operator');
  op2 = await t.userClient(c.api, 'PZE', 'MA2', 'operator');
});
after(t.teardown);

test('statutory breaks: 30 min over 6 h, 45 min over 9 h; over 10 h is flagged', () => {
  const e = (inT, outT, br = 0) => evaluate({ clock_in: inT, clock_out: outT, break_minutes: br }, outT);
  assert.equal(e('2026-11-02 07:00', '2026-11-02 12:00').worked_minutes, 300);
  const seven = e('2026-11-02 07:00', '2026-11-02 14:00');
  assert.equal(seven.break_applied, 30);
  assert.equal(seven.statutory_break_added, true);
  assert.equal(e('2026-11-02 06:00', '2026-11-02 16:00', 60).worked_minutes, 540); // own 60 min break counts
  const long = e('2026-11-02 05:00', '2026-11-02 17:00');
  assert.equal(long.break_applied, 45);
  assert.equal(long.over_10h, true);
});

test('clock in, break, clock out; only one open entry', async () => {
  assert.equal((await op.api.get('/api/time/status')).body.clocked_in, false);
  await op.api.post('/api/time/clock-out', {}).expect(400);
  await op.api.post('/api/time/clock-in', {}).expect(201);
  await op.api.post('/api/time/clock-in', {}).expect(400);
  assert.equal((await op.api.post('/api/time/break', {})).body.break_started !== null, true);
  const st = (await op.api.get('/api/time/status')).body;
  assert.equal(st.on_break, true);
  await op.api.post('/api/time/break', {}).expect(200); // end break
  const out = (await op.api.post('/api/time/clock-out', {}).expect(200)).body;
  assert.ok(out.clock_out);
  assert.equal((await op.api.get('/api/time/status')).body.clocked_in, false);
});

test('employees see only their own times; managers correct with a reason', async () => {
  await op.api.get(`/api/time/entries?user_id=${op2.id}`).expect(403);
  await op.api.post('/api/time/entries', { user_id: op.id, clock_in: '2026-11-03 07:00', clock_out: '2026-11-03 15:30', note: 'vergessen' }).expect(403);
  await c.api.post('/api/time/entries', { user_id: op2.id, clock_in: '2026-11-03 07:00', clock_out: '2026-11-03 15:30' }).expect(400); // reason
  await c.api.post('/api/time/entries', { user_id: op2.id, clock_in: '2026-11-03 15:00', clock_out: '2026-11-03 07:00', note: 'falsch' }).expect(400);
  const e = await c.api.post('/api/time/entries', { user_id: op2.id, clock_in: '2026-11-03 07:00', clock_out: '2026-11-03 15:30', note: 'Stempeln vergessen' });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal(e.body.worked_minutes, 480); // 8.5 h span, 30 min statutory break
  const fixed = await c.api.put(`/api/time/entries/${e.body.id}`, { clock_out: '2026-11-03 16:00', break_minutes: 45, note: 'Korrektur Schichtende' });
  assert.equal(fixed.body.worked_minutes, 495);
  await c.api.post('/api/time/entries', { user_id: op2.id, clock_in: '2026-11-04 07:00', clock_out: '2026-11-04 15:45', break_minutes: 30, note: 'Nachtrag' }).expect(201);
});

test('monthly report and CSV for payroll', async () => {
  await c.api.put('/api/settings/company', { daily_target_hours: 8 }).expect(200);
  const r = (await c.api.get('/api/time/report?month=2026-11').expect(200)).body;
  const ma2 = r.rows.find((x) => x.badge_number === 'MA2');
  assert.equal(ma2.days, 2);
  assert.equal(ma2.hours, 16.5); // 8.25 + 8.25
  assert.equal(ma2.overtime_hours, 0.5);
  assert.equal(ma2.corrections, 2);
  const csv = await c.api.get('/api/time/report?month=2026-11&format=csv');
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /MA2;Test operator;2;16,5;16;0,5/);
  await op.api.get('/api/time/report?month=2026-11').expect(403);
  assert.equal((await other.api.get('/api/time/report?month=2026-11')).body.rows.length, 0);
});
