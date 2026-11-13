/**
 * Payment reminders (Mahnwesen) and DATEV export.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');
const { COLUMNS, encodeCp1252 } = require('../lib/datev');

let c; let acc; let customer; let euCustomer; let overdue;

const binary = (req) => req.buffer(true).parse((res, cb) => {
  const chunks = [];
  res.on('data', (x) => chunks.push(x));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});

async function invoice(cust, lines, extra = {}) {
  const d = await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: cust.id, lines, ...extra });
  const r = await c.api.post(`/api/sales/${d.body.id}/issue`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('FIBU');
  acc = await t.userClient(c.api, 'FIBU', 'ACC1', 'accounting');
  await c.api.put('/api/settings/company', {
    legal_name: 'Fibu GmbH', street: 'Ring 1', postal_code: '20095', city: 'Hamburg', vat_id: 'DE111111111',
    iban: 'DE89370400440532013000', dunning_fee: 5, dunning_grace_days: 3,
  }).expect(200);
  customer = (await c.api.post('/api/customers', { name: 'Müller & Söhne KG', street: 'Weg 1', postal_code: '28195', city: 'Bremen' })).body;
  euCustomer = (await c.api.post('/api/customers', { name: 'Brussels SA', street: 'Rue 1', postal_code: '1000', city: 'Bruxelles', country: 'BE', vat_id: 'BE0123456789' })).body;
  // Dated early in the year, due after 14 days: overdue now.
  overdue = await invoice(customer, [{ description: 'Altauftrag', quantity: 1, unit_price: 1000 }], { document_date: '2026-01-05' });
});
after(t.teardown);

describe('payment reminders', () => {
  test('overdue invoices are proposed for a reminder', async () => {
    const res = await acc.api.get('/api/sales/dunning/proposals');
    assert.equal(res.status, 200);
    const p = res.body.find((x) => x.id === overdue.id);
    assert.ok(p, 'overdue invoice proposed');
    assert.equal(p.next_level, 1);
    assert.ok(p.days_overdue > 3);
  });

  test('three levels: reminder (no fee), then dunning letters with fee; never more than three', async () => {
    const first = await acc.api.post(`/api/sales/${overdue.id}/dunning`, {});
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.level, 1);
    assert.equal(first.body.fee, 0);
    assert.match(first.body.number, /^MA-\d{4}-00001$/);

    // Too early for the next level ...
    assert.equal((await acc.api.post(`/api/sales/${overdue.id}/dunning`, {})).status, 400);
    // ... unless forced.
    const second = await acc.api.post(`/api/sales/${overdue.id}/dunning`, { force: true });
    assert.equal(second.body.level, 2);
    assert.equal(second.body.fee, 5);
    const third = await acc.api.post(`/api/sales/${overdue.id}/dunning`, { force: true });
    assert.equal(third.body.level, 3);
    assert.equal((await acc.api.post(`/api/sales/${overdue.id}/dunning`, { force: true })).status, 400);

    const list = await acc.api.get(`/api/sales/${overdue.id}/dunning`);
    assert.equal(list.body.length, 3);
    assert.ok(list.body.every((n) => n.file_id));
    const pdf = await binary(acc.api.get(`/api/sales/${overdue.id}/files/${list.body[2].file_id}`));
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
  });

  test('paid invoices are not dunned', async () => {
    const inv = await invoice(customer, [{ description: 'x', quantity: 1, unit_price: 10 }], { document_date: '2026-02-01' });
    await acc.api.post(`/api/sales/${inv.id}/payments`, { payment_date: '2026-02-03', amount: 11.9 }).expect(201);
    const res = await acc.api.get('/api/sales/dunning/proposals');
    assert.ok(!res.body.some((x) => x.id === inv.id));
    assert.equal((await acc.api.post(`/api/sales/${inv.id}/dunning`, { force: true })).status, 400);
  });

  test('sales staff cannot send reminders', async () => {
    const sales = await t.userClient(c.api, 'FIBU', 'VK9', 'sales');
    assert.equal((await sales.api.post(`/api/sales/${overdue.id}/dunning`, {})).status, 403);
  });
});

describe('DATEV export', () => {
  let rows; let header; let cols;

  before(async () => {
    await invoice(customer, [
      { description: 'Teile', quantity: 10, unit_price: 100, tax_rate: 19 },
      { description: 'Handbuch', quantity: 1, unit_price: 50, tax_rate: 7 },
    ], { document_date: '2026-03-10' });
    const eu = await invoice(euCustomer, [{ description: 'Export', quantity: 1, unit_price: 500 }], { document_date: '2026-03-12' });
    await acc.api.post(`/api/sales/${eu.id}/payments`, { payment_date: '2026-03-20', amount: 490, skonto_amount: 10 }).expect(201);
  });

  test('requires the DATEV consultant and client numbers', async () => {
    const res = await acc.api.get('/api/datev/export?from=2026-03-01&to=2026-03-31');
    assert.equal(res.status, 400);
    await c.api.put('/api/settings/company', { datev_consultant_number: 1234567, datev_client_number: 10001 }).expect(200);
  });

  test('exports one fiscal year at a time', async () => {
    assert.equal((await acc.api.get('/api/datev/export?from=2025-12-01&to=2026-01-31')).status, 400);
  });

  test('produces a valid EXTF Buchungsstapel', async () => {
    const res = await binary(acc.api.get('/api/datev/export?from=2026-03-01&to=2026-03-31'));
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], /EXTF_Buchungsstapel_2026-03-01_2026-03-31\.csv/);
    const text = res.body.toString('latin1');
    const lines = text.split('\r\n').filter(Boolean);
    header = lines[0].split(';');
    cols = lines[1].split(';');
    rows = lines.slice(2).map((l) => l.split(';'));

    assert.equal(header.length, 31);
    assert.deepEqual(header.slice(0, 5), ['"EXTF"', '700', '21', '"Buchungsstapel"', '13']);
    assert.equal(header[10], '1234567');
    assert.equal(header[11], '10001');
    assert.equal(header[12], '20260101');
    assert.equal(header[14], '20260301');
    assert.equal(header[15], '20260331');
    assert.equal(header[26], '"03"');
    assert.equal(cols.length, 125);
    assert.equal(cols.length, COLUMNS.length);
    assert.ok(rows.every((r) => r.length === 125));
  });

  test('invoice bookings: customer against the right revenue account', async () => {
    const col = (name) => cols.indexOf(name);
    const booking = (acct) => rows.find((r) => r[col('Gegenkonto (ohne BU-Schlüssel)')] === String(acct));
    const r19 = booking(8400);
    assert.equal(r19[col('Umsatz (ohne Soll/Haben-Kz)')], '1190,00');
    assert.equal(r19[col('Soll/Haben-Kennzeichen')], '"S"');
    assert.equal(r19[col('Konto')], String(customer.datev_account));
    assert.equal(r19[col('Belegdatum')], '1003');
    assert.match(r19[col('Belegfeld 1')], /^"RE-2026-\d{5}"$/);
    assert.equal(booking(8300)[col('Umsatz (ohne Soll/Haben-Kz)')], '53,50');
    const eu = booking(8125);
    assert.equal(eu[col('Umsatz (ohne Soll/Haben-Kz)')], '500,00');
    assert.equal(eu[col('EU-Land u. USt-IdNr.')], '"BE0123456789"');
  });

  test('payment booking: bank against customer, with early-payment discount', async () => {
    const col = (name) => cols.indexOf(name);
    const pay = rows.find((r) => r[col('Konto')] === '1200');
    assert.equal(pay[col('Umsatz (ohne Soll/Haben-Kz)')], '490,00');
    assert.equal(pay[col('Gegenkonto (ohne BU-Schlüssel)')], String(euCustomer.datev_account));
    assert.equal(pay[col('Skonto')], '10,00');
  });

  test('SKR04 uses the SKR04 accounts', async () => {
    await c.api.put('/api/settings/company', { datev_chart: 'SKR04' }).expect(200);
    const res = await binary(acc.api.get('/api/datev/export?from=2026-03-01&to=2026-03-31'));
    const text = res.body.toString('latin1');
    assert.match(text, /;4400;/);
    assert.match(text, /;1800;/);
    assert.match(text.split('\r\n')[0], /"04"/);
  });

  test('German characters are encoded as Windows-1252', () => {
    assert.deepEqual([...encodeCp1252('Müller € ß')], [0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x20, 0x80, 0x20, 0xdf]);
  });
});
