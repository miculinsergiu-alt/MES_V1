/**
 * Excel/CSV import: German column names and number formats, preview with
 * row errors, all-or-nothing commit, updates, stock and BOMs.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('@e965/xlsx');
const t = require('./helpers');
const { parseNumber, parseDate } = require('../services/importer');

let c; let sales;

const xlsx = (rows) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Tabelle1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
const send = (api, url, buffer, filename, extra = {}) => api.post(url, { filename, content_base64: buffer.toString('base64'), ...extra });

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('IMPORT');
  sales = await t.userClient(c.api, 'IMPORT', 'VK1', 'sales');
});
after(t.teardown);

describe('parsing', () => {
  test('German and English number formats', () => {
    assert.equal(parseNumber('1.234,56'), 1234.56);
    assert.equal(parseNumber('12,5'), 12.5);
    assert.equal(parseNumber('1,234.56'), 1234.56);
    assert.equal(parseNumber('19 %'), 19);
    assert.equal(parseNumber('12,50 €'), 12.5);
    assert.ok(Number.isNaN(parseNumber('abc')));
  });
  test('dates', () => {
    assert.equal(parseDate('31.12.2026'), '2026-12-31');
    assert.equal(parseDate('2026-01-05'), '2026-01-05');
    assert.equal(parseDate('morgen'), 'invalid');
  });
});

describe('items', () => {
  test('preview recognises German columns and reports row errors', async () => {
    const file = xlsx([
      ['Artikelnummer', 'Bezeichnung', 'Typ', 'Einheit', 'Verkaufspreis', 'MwSt'],
      ['WB-100', 'Winkelblech', 'Fertigprodukt', 'Stk', '12,50', 19],
      ['ST-1', 'Stahl S235', 'Rohstoff', 'kg', 2.1, 19],
      ['', 'Ohne Nummer', 'Rohstoff', 'kg', 1, 19],
      ['X-1', 'Falscher Typ', 'Gemüse', 'Stk', 'teuer', 16],
    ]);
    const res = await send(c.api, '/api/import/items/preview', file, 'artikel.xlsx');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.mapping, { item_code: 'Artikelnummer', name: 'Bezeichnung', type: 'Typ', uom: 'Einheit', unit_price: 'Verkaufspreis', tax_rate: 'MwSt' });
    assert.equal(res.body.valid_count, 2);
    assert.equal(res.body.error_count, 2);
    const bad = res.body.rows.find((r) => r.row === 5);
    assert.equal(bad.errors.length, 3);
    assert.equal(res.body.rows[0].data.unit_price, 12.5);
    assert.equal(res.body.rows[0].data.type, 'finished_good');
  });

  test('nothing is imported while any row has errors', async () => {
    const file = xlsx([['Artikelnummer', 'Bezeichnung'], ['OK-1', 'Gut'], ['', 'Schlecht']]);
    const res = await send(c.api, '/api/import/items', file, 'a.xlsx');
    assert.equal(res.status, 400);
    assert.equal((await c.api.get('/api/items')).body.length, 0);
  });

  test('import creates and later updates items', async () => {
    const file = xlsx([['Artikelnummer', 'Bezeichnung', 'Typ', 'Verkaufspreis'], ['WB-100', 'Winkelblech', 'Fertigprodukt', '12,50'], ['ST-1', 'Stahl S235', 'Rohstoff', '']]);
    const res = await send(c.api, '/api/import/items', file, 'a.xlsx');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.created, res.body.updated], [2, 0]);

    const again = xlsx([['Artikelnummer', 'Bezeichnung', 'Verkaufspreis'], ['WB-100', 'Winkelblech verzinkt', '13']]);
    const res2 = await send(c.api, '/api/import/items', again, 'b.xlsx');
    assert.deepEqual([res2.body.created, res2.body.updated], [0, 1]);
    const item = (await c.api.get('/api/items')).body.find((i) => i.item_code === 'WB-100');
    assert.equal(item.name, 'Winkelblech verzinkt');
    assert.equal(item.unit_price, 13);
    assert.equal(item.type, 'finished_good'); // unchanged, column not in the file
  });

  test('duplicates inside the file are reported', async () => {
    const file = xlsx([['Artikelnummer', 'Bezeichnung'], ['D-1', 'a'], ['D-1', 'b']]);
    const res = await send(c.api, '/api/import/items/preview', file, 'a.xlsx');
    assert.match(res.body.rows[1].errors[0], /more than once/);
  });
});

describe('customers from a German Excel CSV', () => {
  test('semicolon CSV in Windows-1252 with umlauts and country names', async () => {
    const csv = 'Firma;Straße;PLZ;Ort;Land;USt-IdNr;E-Mail;Zahlungsziel\r\n'
      + 'Müller & Söhne KG;Hauptstraße 5;80331;München;Deutschland;;info@mueller.de;30\r\n'
      + 'Wiener Anlagen AG;Ring 1;1010;Wien;Österreich;ATU12345678;;14\r\n';
    const buf = Buffer.from(csv, 'latin1'); // Windows-1252 for these characters
    const res = await send(sales.api, '/api/import/customers', buf, 'kunden.csv');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.created, 2);
    const list = (await sales.api.get('/api/customers')).body;
    const m = list.find((x) => x.name === 'Müller & Söhne KG');
    assert.equal(m.city, 'München');
    assert.equal(m.customer_number, '10001');
    assert.equal(m.payment_terms_days, 30);
    const w = list.find((x) => x.country === 'AT');
    assert.equal(w.tax_treatment, 'intra_eu');
  });

  test('roles: sales may import customers but not items', async () => {
    const file = xlsx([['Artikelnummer', 'Bezeichnung'], ['Z', 'z']]);
    assert.equal((await send(sales.api, '/api/import/items/preview', file, 'a.xlsx')).status, 403);
  });
});

describe('stock and BOMs', () => {
  test('opening stock per item from lot rows', async () => {
    const file = xlsx([['Artikelnummer', 'Bestand', 'Charge', 'Lagerplatz'], ['ST-1', '1.000,5', 'CH-1', 'A-01'], ['ST-1', '250', 'CH-2', 'A-01'], ['WB-100', 40, '', '']]);
    const res = await send(c.api, '/api/import/stock', file, 'bestand.xlsx');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const stock = (await c.api.get('/api/stock')).body;
    const s = stock.find((x) => x.item_code === 'ST-1');
    assert.equal(s.quantity, 1250.5);
    assert.equal(s.location, 'A-01');
    assert.equal((await c.api.get('/api/inventory/traceability/CH-2')).body.lot.quantity, 250);
  });

  test('unknown items in stock rows are reported', async () => {
    const file = xlsx([['Artikelnummer', 'Bestand'], ['GIBTSNICHT', 1]]);
    const res = await send(c.api, '/api/import/stock/preview', file, 'x.xlsx');
    assert.match(res.body.rows[0].errors[0], /does not exist/);
  });

  test('BOMs: one bill of materials per parent item', async () => {
    const file = xlsx([['Baugruppe', 'Komponente', 'Menge'], ['WB-100', 'ST-1', '0,85']]);
    const res = await send(c.api, '/api/import/boms', file, 'stl.xlsx');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const boms = (await c.api.get('/api/boms')).body;
    assert.equal(boms.length, 1);
    const tree = (await c.api.get(`/api/boms/${boms[0].id}/tree`)).body.tree;
    assert.equal(tree[0].quantity, 0.85);
    // Re-import replaces the positions
    await send(c.api, '/api/import/boms', xlsx([['Baugruppe', 'Komponente', 'Menge'], ['WB-100', 'ST-1', 1]]), 'stl.xlsx').expect(200);
    assert.equal((await c.api.get('/api/boms')).body.length, 1);
  });
});

test('templates can be downloaded as Excel files', async () => {
  const res = await c.api.get('/api/import/customers/template').buffer(true).parse((r, cb) => { const ch = []; r.on('data', (x) => ch.push(x)); r.on('end', () => cb(null, Buffer.concat(ch))); });
  assert.equal(res.status, 200);
  const wb = XLSX.read(res.body, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  assert.equal(rows[0][0], 'Kundennummer');
  assert.equal(rows[1][1], 'Muster Maschinenbau GmbH');
});
