/**
 * Sales & invoicing: settings, customers, quote → order → delivery → invoice,
 * GoBD locking, gap-free numbers, credit notes, VAT cases, payments.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');

let c; let salesUser; let product; let service; let customer; let euCustomer;

const COMPANY_SETTINGS = {
  legal_name: 'Muster Metallbau GmbH', street: 'Industriestraße 5', postal_code: '80331', city: 'München',
  vat_id: 'DE123456789', tax_number: '143/123/45678', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX',
  register_court: 'Amtsgericht München', register_number: 'HRB 123456', managing_directors: 'Max Mustermann',
};

const stockOf = async (itemId) => (await c.api.get('/api/stock')).body.find((s) => s.item_id === itemId)?.quantity ?? 0;
const issue = (id, body) => salesUser.api.post(`/api/sales/${id}/issue`, body);

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('SALES');
  salesUser = await t.userClient(c.api, 'SALES', 'VK1', 'sales');
  product = await t.createItem(c.api, 'BRACKET', 'finished_good', { unit_price: 12.5, tax_rate: 19 });
  service = await t.createItem(c.api, 'MANUAL', 'finished_good', { unit_price: 20, tax_rate: 7 });
  await c.api.post('/api/stock/adjust', { item_id: product, quantity: 100 }).expect(200);
});
after(t.teardown);

describe('company settings', () => {
  test('missing invoice data is reported', async () => {
    const res = await c.api.get('/api/settings/company');
    assert.equal(res.status, 200);
    assert.ok(res.body.missing_for_invoices.includes('street'));
  });

  test('invalid IBAN is rejected, valid data is saved and normalised', async () => {
    assert.equal((await c.api.put('/api/settings/company', { iban: 'DE89 3704 0044 0532 0130 01' })).status, 400);
    const res = await c.api.put('/api/settings/company', COMPANY_SETTINGS);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.iban, 'DE89370400440532013000');
    assert.deepEqual(res.body.missing_for_invoices, []);
  });

  test('only administrators can change settings', async () => {
    assert.equal((await salesUser.api.put('/api/settings/company', { city: 'Berlin' })).status, 403);
  });

  test('number series can move forward but never backwards', async () => {
    const series = await c.api.get('/api/settings/number-series');
    assert.equal(series.body.find((s) => s.doc_type === 'invoice').next_preview.slice(0, 3), 'RE-');
    assert.equal((await c.api.put('/api/settings/number-series/quote', { next_number: 100 })).status, 200);
    assert.equal((await c.api.put('/api/settings/number-series/quote', { next_number: 50 })).status, 400);
  });
});

describe('customers', () => {
  test('customer numbers are assigned automatically and double as DATEV account', async () => {
    const res = await salesUser.api.post('/api/customers', {
      name: 'Kunde GmbH', street: 'Hauptstraße 1', postal_code: '10115', city: 'Berlin', country: 'DE', email: 'einkauf@kunde.de',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.customer_number, '10001');
    assert.equal(res.body.datev_account, 10001);
    assert.equal(res.body.tax_treatment, 'domestic');
    customer = res.body;
  });

  test('tax treatment follows country and VAT ID', async () => {
    const at = await salesUser.api.post('/api/customers', { name: 'Wien AG', street: 'Ring 1', postal_code: '1010', city: 'Wien', country: 'AT', vat_id: 'atu 12345678' });
    assert.equal(at.body.tax_treatment, 'intra_eu');
    assert.equal(at.body.vat_id, 'ATU12345678');
    euCustomer = at.body;
    const ch = await salesUser.api.post('/api/customers', { name: 'Zürich AG', street: 'Bahnhofstr. 1', postal_code: '8001', city: 'Zürich', country: 'CH' });
    assert.equal(ch.body.tax_treatment, 'export');
    const fr = await salesUser.api.post('/api/customers', { name: 'Particulier', street: 'Rue 1', postal_code: '75001', city: 'Paris', country: 'FR' });
    assert.equal(fr.body.tax_treatment, 'domestic'); // consumer in the EU: German VAT
    assert.equal((await salesUser.api.post('/api/customers', { name: 'x', vat_id: 'XX123' })).status, 400);
  });

  test('search', async () => {
    const res = await salesUser.api.get('/api/customers?search=wien');
    assert.equal(res.body.length, 1);
  });
});

describe('quote → order → delivery note → invoice', () => {
  let quote; let order; let delivery; let invoice;

  test('a quote is a draft until issued; totals use item prices and VAT rates', async () => {
    const res = await salesUser.api.post('/api/sales', {
      doc_type: 'quote', customer_id: customer.id,
      lines: [
        { item_id: product, quantity: 10 },
        { item_id: service, quantity: 1, discount_percent: 10 },
        { description: 'Verpackung & Versand', quantity: 1, unit: 'psch', unit_price: '15.00' },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    quote = res.body;
    assert.equal(quote.status, 'draft');
    assert.equal(quote.number, null);
    assert.equal(quote.net_total, 158); // 125 + 18 + 15
    assert.deepEqual(quote.tax_breakdown.map((b) => [b.tax_rate, b.net_amount, b.tax_amount]), [[19, 140, 26.6], [7, 18, 1.26]]);
    assert.equal(quote.gross_total, 185.86);
    assert.ok(quote.valid_until);
  });

  test('issuing assigns the next number of the series', async () => {
    const res = await issue(quote.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.number, /^AN-\d{4}-00100$/);
    assert.equal(res.body.locked, 1);
  });

  test('quote → order confirmation (with make-to-order production)', async () => {
    const machine = await t.createMachine(c.api, 'Laser');
    await c.api.put(`/api/items/${product}`, { routes: [{ machine_id: machine, process_time_min: 2 }] }).expect(200);

    const conv = await salesUser.api.post(`/api/sales/${quote.id}/convert`, { target: 'order' });
    assert.equal(conv.status, 201, JSON.stringify(conv.body));
    assert.equal(conv.body.lines.length, 3);
    assert.equal((await salesUser.api.get(`/api/sales/${quote.id}`)).body.status, 'accepted');

    const res = await issue(conv.body.id, { create_production: { planned_start: '2030-06-01 06:00' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    order = res.body;
    assert.match(order.number, /^AB-/);
    const productionId = order.lines[0].production_order_id;
    assert.ok(productionId, 'production order linked to the order line');
    const prod = (await c.api.get(`/api/orders/${productionId}`)).body;
    assert.equal(prod.quantity, 10);
    assert.equal(prod.planned_start, '2030-06-01 06:00:00');
  });

  test('partial delivery books stock out and updates the order', async () => {
    const conv = await salesUser.api.post(`/api/sales/${order.id}/convert`, { target: 'delivery' });
    const lines = conv.body.lines.map((l) => ({
      item_id: l.item_id, description: l.description, unit: l.unit, unit_price: l.unit_price,
      discount_percent: l.discount_percent, source_line_id: l.source_line_id,
      quantity: l.item_id === product ? 4 : l.quantity,
    }));
    assert.equal((await salesUser.api.put(`/api/sales/${conv.body.id}`, { lines })).status, 200);
    const first = await issue(conv.body.id);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(await stockOf(product), 96);
    let o = (await salesUser.api.get(`/api/sales/${order.id}`)).body;
    assert.equal(o.status, 'partially_delivered');
    assert.equal(o.lines[0].delivered_quantity, 4);

    // Second delivery: only the remaining 6 pieces are proposed
    const rest = await salesUser.api.post(`/api/sales/${order.id}/convert`, { target: 'delivery' });
    assert.deepEqual(rest.body.lines.map((l) => l.quantity), [6]);
    delivery = (await issue(rest.body.id)).body;
    assert.equal(await stockOf(product), 90);
    o = (await salesUser.api.get(`/api/sales/${order.id}`)).body;
    assert.equal(o.status, 'delivered');

    // Links to lines of other documents are refused
    const bad = await salesUser.api.post('/api/sales', { doc_type: 'delivery', customer_id: customer.id, lines: [{ description: 'x', quantity: 1, source_line_id: o.lines[0].id }] });
    assert.equal(bad.status, 400);
  });

  test('invoice for everything delivered (from the order)', async () => {
    const conv = await salesUser.api.post(`/api/sales/${order.id}/convert`, { target: 'invoice' });
    assert.equal(conv.status, 201);
    assert.equal(conv.body.lines.length, 3);
    await salesUser.api.delete(`/api/sales/${conv.body.id}`).expect(200);
  });

  test('invoice from the order; missing company data blocks issuing', async () => {
    const conv = await salesUser.api.post(`/api/sales/${order.id}/convert`, { target: 'invoice' });
    assert.equal(conv.status, 201);

    await c.api.put('/api/settings/company', { street: '' }).expect(200);
    const blocked = await issue(conv.body.id);
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.error, /address/);
    // The failed attempt must not have used up an invoice number.
    await c.api.put('/api/settings/company', COMPANY_SETTINGS).expect(200);

    const res = await issue(conv.body.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    invoice = res.body;
    assert.match(invoice.number, /^RE-\d{4}-00001$/);
    assert.ok(invoice.due_date);
    assert.equal(invoice.gross_total, 185.86);
    assert.ok(invoice.content_hash);

    const o = (await salesUser.api.get(`/api/sales/${order.id}`)).body;
    assert.equal(o.status, 'closed');
  });

  test('issued invoices cannot be changed or deleted (also not directly in the database)', async () => {
    assert.equal((await salesUser.api.put(`/api/sales/${invoice.id}`, { intro_text: 'changed' })).status, 409);
    assert.equal((await salesUser.api.delete(`/api/sales/${invoice.id}`)).status, 409);
    await assert.rejects(
      t.db.withContext({ companyId: c.company.id }, () => t.db.run('UPDATE sales_documents SET gross_total = 1 WHERE id = ?', [invoice.id])),
      /cannot be changed/,
    );
    await assert.rejects(
      t.db.withContext({ companyId: c.company.id }, () => t.db.run('UPDATE sales_document_lines SET unit_price = 0 WHERE document_id = ?', [invoice.id])),
      /cannot be changed/,
    );
    const verify = await salesUser.api.get(`/api/sales/${invoice.id}/verify`);
    assert.equal(verify.body.content_unchanged, true);
  });

  test('payments: partial, overpayment rejected, rest with early-payment discount', async () => {
    const acc = await t.userClient(c.api, 'SALES', 'FIBU1', 'accounting');
    assert.equal((await salesUser.api.post(`/api/sales/${invoice.id}/payments`, { payment_date: '2030-07-01', amount: 10 })).status, 403);

    let r = await acc.api.post(`/api/sales/${invoice.id}/payments`, { payment_date: '2030-07-01', amount: '100.00', reference: 'Überweisung' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'partially_paid');
    assert.equal(r.body.open_amount, 85.86);

    r = await acc.api.post(`/api/sales/${invoice.id}/payments`, { payment_date: '2030-07-02', amount: 200 });
    assert.equal(r.status, 400);

    r = await acc.api.post(`/api/sales/${invoice.id}/payments`, { payment_date: '2030-07-02', amount: 84.14, skonto_amount: 1.72 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'paid');
    assert.equal(r.body.open_amount, 0);
  });
});

describe('credit notes (Rechnungskorrektur)', () => {
  let inv;
  before(async () => {
    const d = await salesUser.api.post('/api/sales', { doc_type: 'invoice', customer_id: customer.id, lines: [{ item_id: product, quantity: 2 }] });
    inv = (await issue(d.body.id)).body;
    assert.match(inv.number, /-00002$/);
  });

  test('a full credit note cancels the invoice and has its own number series', async () => {
    const cn = await salesUser.api.post(`/api/sales/${inv.id}/convert`, { target: 'credit_note' });
    assert.equal(cn.status, 201, JSON.stringify(cn.body));
    assert.match(cn.body.intro_text, new RegExp(inv.number));
    const issued = await issue(cn.body.id);
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.match(issued.body.number, /^RK-\d{4}-00001$/);
    const after = (await salesUser.api.get(`/api/sales/${inv.id}`)).body;
    assert.equal(after.status, 'cancelled');
    assert.equal(after.credited_total, inv.gross_total);
    assert.equal(after.open_amount, 0);
  });

  test('cannot credit more than the invoice', async () => {
    const res = await salesUser.api.post(`/api/sales/${inv.id}/convert`, { target: 'credit_note' });
    assert.equal(res.status, 400);
  });

  test('the next invoice number continues without gaps', async () => {
    const d = await salesUser.api.post('/api/sales', { doc_type: 'invoice', customer_id: customer.id, lines: [{ description: 'Service', quantity: 1, unit_price: 50 }] });
    const res = await issue(d.body.id);
    assert.match(res.body.number, /-00003$/);
  });
});

describe('VAT cases', () => {
  test('intra-EU delivery: 0 % VAT, category K, legal note, both VAT IDs', async () => {
    const d = await salesUser.api.post('/api/sales', { doc_type: 'invoice', customer_id: euCustomer.id, lines: [{ item_id: product, quantity: 10 }] });
    assert.equal(d.body.tax_treatment, 'intra_eu');
    assert.equal(d.body.lines[0].tax_category, 'K');
    assert.equal(d.body.tax_total, 0);
    const res = await issue(d.body.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.closing_text, /§ 4 Nr\. 1b/);
    assert.equal(res.body.customer_vat_id, 'ATU12345678');
  });

  test('intra-EU without our own VAT ID is refused', async () => {
    await c.api.put('/api/settings/company', { vat_id: '' }).expect(200);
    const d = await salesUser.api.post('/api/sales', { doc_type: 'invoice', customer_id: euCustomer.id, lines: [{ item_id: product, quantity: 1 }] });
    const res = await issue(d.body.id);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /VAT ID/);
    await c.api.put('/api/settings/company', COMPANY_SETTINGS).expect(200);
  });

  test('small business (§ 19 UStG): no VAT', async () => {
    const k = await t.companyWithAdmin('KLEIN');
    await k.api.put('/api/settings/company', { ...COMPANY_SETTINGS, vat_id: '', small_business: 1 }).expect(200);
    const cust = await k.api.post('/api/customers', { name: 'Kunde', street: 'Weg 1', postal_code: '12345', city: 'Ort' });
    const d = await k.api.post('/api/sales', { doc_type: 'invoice', customer_id: cust.body.id, lines: [{ description: 'Arbeit', quantity: 1, unit_price: 100 }] });
    assert.equal(d.body.tax_total, 0);
    assert.equal(d.body.lines[0].tax_category, 'E');
    const res = await k.api.post(`/api/sales/${d.body.id}/issue`);
    assert.match(res.body.closing_text, /§ 19 UStG/);
  });
});

describe('lists and separation', () => {
  test('open items show unpaid invoices', async () => {
    const res = await salesUser.api.get('/api/sales/open-items');
    assert.equal(res.status, 200);
    assert.ok(res.body.length >= 1);
    assert.ok(res.body.every((r) => r.open_amount > 0));
  });

  test('another company sees none of these documents', async () => {
    const other = await t.companyWithAdmin('OTHERCO');
    assert.equal((await other.api.get('/api/sales')).body.length, 0);
    assert.equal((await other.api.get('/api/customers')).body.length, 0);
    const own = (await salesUser.api.get('/api/sales?doc_type=invoice')).body[0];
    assert.equal((await other.api.get(`/api/sales/${own.id}`)).status, 404);
  });

  test('drafts can be deleted, operators have no access', async () => {
    const d = await salesUser.api.post('/api/sales', { doc_type: 'quote', customer_id: customer.id, lines: [] });
    assert.equal((await salesUser.api.delete(`/api/sales/${d.body.id}`)).status, 200);
    const op = await t.userClient(c.api, 'SALES', 'OPX', 'operator');
    assert.equal((await op.api.get('/api/sales')).status, 403);
  });
});
