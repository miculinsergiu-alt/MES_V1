/**
 * Invoicing from other EU countries and the UK: VAT rates of the seller's country,
 * tax treatment seen from the seller, document language and currency, legal notes.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');
const vat = require('../lib/vat');

describe('lib/vat', () => {
  test('tax treatment is seen from the seller country', () => {
    assert.equal(vat.defaultTaxTreatment('DE', null), 'domestic'); // default seller DE (unchanged behaviour)
    assert.equal(vat.defaultTaxTreatment('AT', 'ATU12345678'), 'intra_eu');
    assert.equal(vat.defaultTaxTreatment('GB', 'GB123456789'), 'export');
    assert.equal(vat.defaultTaxTreatment('GB', null, 'GB'), 'domestic');
    assert.equal(vat.defaultTaxTreatment('IE', 'IE6388047V', 'GB'), 'export');
    assert.equal(vat.defaultTaxTreatment('DE', 'DE123456789', 'GB'), 'export');
    assert.equal(vat.defaultTaxTreatment('DE', 'DE123456789', 'FR'), 'intra_eu');
    assert.equal(vat.defaultTaxTreatment('DE', null, 'FR'), 'domestic');
    assert.equal(vat.defaultTaxTreatment('US', null, 'FR'), 'export');
  });

  test('UK VAT numbers are accepted, invalid ones are not', () => {
    assert.equal(vat.normalizeVatId('GB 123 4567 89'), 'GB123456789');
    assert.equal(vat.normalizeVatId('GB123456789012'), 'GB123456789012');
    assert.equal(vat.normalizeVatId('GBGD001'), 'GBGD001');
    assert.equal(vat.normalizeVatId('GB12345'), null);
    assert.equal(vat.normalizeVatId('ATU12345678'), 'ATU12345678');
  });

  test('line tax uses the item rate, 0 % domestic is zero rated, unknown rate falls back to the standard rate', () => {
    assert.deepEqual(vat.lineTax('domestic', 20, 'GB'), { tax_category: 'S', tax_rate: 20 });
    assert.deepEqual(vat.lineTax('domestic', 0, 'GB'), { tax_category: 'Z', tax_rate: 0 });
    assert.deepEqual(vat.lineTax('domestic', undefined, 'FI'), { tax_category: 'S', tax_rate: 25.5 });
    assert.deepEqual(vat.lineTax('domestic', 7), { tax_category: 'S', tax_rate: 7 });
    assert.deepEqual(vat.lineTax('export', 20, 'GB'), { tax_category: 'G', tax_rate: 0 });
  });

  test('legal notes depend on seller country and language', () => {
    assert.match(vat.taxNote('intra_eu', 'DE', 'de'), /§ 6a UStG/);
    assert.match(vat.taxNote('intra_eu', 'DE', 'en'), /German VAT Act/);
    assert.match(vat.taxNote('intra_eu', 'FR', 'en'), /Article 138/);
    assert.match(vat.taxNote('export', 'GB', 'en'), /Zero-rated export/);
    assert.equal(vat.taxNote('domestic', 'GB', 'en'), null);
    assert.equal(vat.taxNote('intra_eu', 'GB', 'en'), null);
  });
});

describe('UK seller', () => {
  let c; let gbCustomer; let deCustomer; let part;

  before(async () => {
    await t.setup();
    c = await t.companyWithAdmin('UKSHOP');
    const res = await c.api.put('/api/settings/company', {
      country: 'GB', legal_name: 'Midlands Precision Ltd', street: '4 Tyburn Road', postal_code: 'B24 8HJ', city: 'Birmingham',
      vat_id: 'GB 123 4567 89', iban: 'GB29NWBK60161331926819', bic: 'NWBKGB2L', email: 'accounts@mp.example', phone: '+44 121 000',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.currency, 'GBP', 'a new seller country brings its currency');
    assert.equal(res.body.vat_id, 'GB123456789');
    part = await t.createItem(c.api, 'SHAFT', 'finished_good', { unit_price: 31.5 });
    gbCustomer = (await c.api.post('/api/customers', { name: 'Severn Conveyors Ltd', street: '7 Riverside Way', postal_code: 'WR5 3HR', city: 'Worcester' })).body;
    deCustomer = (await c.api.post('/api/customers', {
      name: 'Allgäu Anlagenbau GmbH', street: 'Bahnhofstraße 21', postal_code: '87435', city: 'Kempten', country: 'DE', vat_id: 'DE123456789',
    })).body;
  });
  after(t.teardown);

  test('items get the UK standard rate, customers default to GB and the right treatment', async () => {
    const item = (await c.api.get(`/api/items/${part}`)).body;
    assert.equal(Number(item.tax_rate), 20);
    assert.equal(gbCustomer.country, 'GB');
    assert.equal(gbCustomer.tax_treatment, 'domestic');
    assert.equal(deCustomer.tax_treatment, 'export');
  });

  test('domestic invoice: 20 % VAT, GBP, English, no XRechnung', async () => {
    const d = await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: gbCustomer.id, lines: [{ item_id: part, quantity: 10 }] });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    assert.equal(d.body.currency, 'GBP');
    assert.equal(d.body.language, 'en');
    assert.equal(d.body.title, 'Invoice');
    assert.equal(Number(d.body.net_total), 315);
    assert.equal(Number(d.body.tax_total), 63);
    assert.equal(Number(d.body.gross_total), 378);
    assert.match(d.body.customer_address, /Worcester WR5 3HR$/, 'UK order: town, then postcode; no country line at home');
    const r = await c.api.post(`/api/sales/${d.body.id}/issue`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.number, /^INV-\d{4}-\d{5}$/);
    const full = (await c.api.get(`/api/sales/${d.body.id}`)).body;
    assert.deepEqual(full.files.map((f) => f.kind), ['zugferd']);
    assert.match(full.files[0].filename, /^Invoice_/);
    const pdf = await c.api.get(`/api/sales/${d.body.id}/pdf`);
    assert.equal(pdf.status, 200);
  });

  test('sale to Germany is a zero-rated export with the UK note in German', async () => {
    const d = await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: deCustomer.id, lines: [{ item_id: part, quantity: 2 }] });
    assert.equal(Number(d.body.tax_total), 0);
    assert.equal(d.body.lines[0].tax_category, 'G');
    assert.equal(d.body.language, 'de');
    const r = await c.api.post(`/api/sales/${d.body.id}/issue`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.closing_text, /VAT Act 1994/);
  });

  test('English credit note keeps the invoice language', async () => {
    const d = await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: gbCustomer.id, lines: [{ item_id: part, quantity: 1 }] });
    await c.api.post(`/api/sales/${d.body.id}/issue`).expect(200);
    const cn = await c.api.post(`/api/sales/${d.body.id}/convert`, { target: 'credit_note' });
    assert.equal(cn.status, 201, JSON.stringify(cn.body));
    assert.equal(cn.body.language, 'en');
    const r = await c.api.post(`/api/sales/${cn.body.id}/issue`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.intro_text, /^Correction to invoice /);
  });

  test('the countries endpoint lists rates and currencies', async () => {
    const res = await c.api.get('/api/settings/vat-countries');
    assert.deepEqual(res.body.GB.rates, [20, 5]);
    assert.equal(res.body.IE.currency, 'EUR');
  });
});

describe('EU sellers other than Germany', () => {
  let c; let deCustomer; let frConsumer; let part;

  before(async () => {
    await t.setup();
    c = await t.companyWithAdmin('ATSHOP');
    await c.api.put('/api/settings/company', {
      country: 'AT', legal_name: 'Tiroler Zerspanung GmbH', street: 'Innrain 40', postal_code: '6020', city: 'Innsbruck', vat_id: 'ATU12345678',
    }).expect(200);
    part = await t.createItem(c.api, 'FLANGE', 'finished_good', { unit_price: 50 });
    deCustomer = (await c.api.post('/api/customers', { name: 'Kunde GmbH', street: 'Allee 1', postal_code: '80331', city: 'München', country: 'DE', vat_id: 'DE123456789' })).body;
    frConsumer = (await c.api.post('/api/customers', { name: 'Jean Dupont', street: '1 rue de Paris', postal_code: '75001', city: 'Paris', country: 'FR' })).body;
  });
  after(t.teardown);

  test('Austrian seller: 20 % at home, intra-EU supply to Germany with the Directive note', async () => {
    assert.equal(deCustomer.tax_treatment, 'intra_eu');
    const d = await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: deCustomer.id, lines: [{ item_id: part, quantity: 4 }] });
    assert.equal(d.body.lines[0].tax_category, 'K');
    const r = await c.api.post(`/api/sales/${d.body.id}/issue`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.closing_text, /Art\. 138 Richtlinie 2006\/112\/EG/);
    const full = (await c.api.get(`/api/sales/${d.body.id}`)).body;
    assert.ok(!full.files.some((f) => f.kind === 'xrechnung'), 'XRechnung only for German sellers');
  });

  test('consumer in another EU country pays the seller country rate (below the OSS threshold), in English', async () => {
    const d = await c.api.post('/api/sales', { doc_type: 'quote', customer_id: frConsumer.id, lines: [{ item_id: part, quantity: 1 }] });
    assert.equal(Number(d.body.lines[0].tax_rate), 20);
    assert.equal(d.body.language, 'en');
    assert.equal(d.body.title, 'Quotation');
  });

  test('changing the seller country recomputes the customers\' tax treatment', async () => {
    await c.api.put('/api/settings/company', { country: 'DE' }).expect(200);
    assert.equal((await c.api.get(`/api/customers/${deCustomer.id}`)).body.tax_treatment, 'domestic');
    const company = (await c.api.get('/api/settings/company')).body;
    assert.equal(company.currency, 'EUR');
  });
});

describe('German seller (unchanged behaviour)', () => {
  let c; let ukCustomer; let part;

  before(async () => {
    await t.setup();
    c = await t.companyWithAdmin('DESHOP');
    await c.api.put('/api/settings/company', {
      legal_name: 'Muster GmbH', street: 'Industriestraße 5', postal_code: '80331', city: 'München', vat_id: 'DE123456789',
    }).expect(200);
    part = await t.createItem(c.api, 'BRACKET', 'finished_good', { unit_price: 10 });
    ukCustomer = (await c.api.post('/api/customers', { name: 'Severn Ltd', street: '7 Riverside Way', postal_code: 'WR5 3HR', city: 'Worcester', country: 'GB', vat_id: 'GB123456789' })).body;
  });
  after(t.teardown);

  test('items still default to 19 %, UK customers are an export with the UStG note in English', async () => {
    assert.equal(Number((await c.api.get(`/api/items/${part}`)).body.tax_rate), 19);
    assert.equal(ukCustomer.tax_treatment, 'export');
    const d = await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: ukCustomer.id, lines: [{ item_id: part, quantity: 1 }] });
    assert.equal(d.body.language, 'en');
    assert.equal(d.body.currency, 'EUR');
    const r = await c.api.post(`/api/sales/${d.body.id}/issue`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.closing_text, /§ 4 No\. 1a .* German VAT Act/);
  });

  test('the document language can be set per customer', async () => {
    const res = await c.api.put(`/api/customers/${ukCustomer.id}`, { language: 'de' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = await c.api.post('/api/sales', { doc_type: 'quote', customer_id: ukCustomer.id, lines: [{ item_id: part, quantity: 1 }] });
    assert.equal(d.body.language, 'de');
    assert.equal(d.body.title, 'Angebot');
  });
});
