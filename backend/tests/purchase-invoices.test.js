/**
 * Incoming e-invoices: company A issues an invoice, company B receives the
 * file (ZUGFeRD PDF, XRechnung CII, XRechnung UBL) and processes it.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const t = require('./helpers');
const einvoice = require('../services/einvoice');

let seller; let buyer; let accounting; let planner;
let zugferd; let xrechnung; let issued; let poId; let supplierId;

const binary = (req) => req.buffer(true).parse((res, cb) => {
  const chunks = [];
  res.on('data', (x) => chunks.push(x));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});
const upload = (api, buffer, filename) => api.post('/api/purchase-invoices', { filename, content_base64: buffer.toString('base64') });

before(async () => {
  await t.setup();
  // Seller: issues the invoice
  seller = await t.companyWithAdmin('LIEFERANT');
  await seller.api.put('/api/settings/company', {
    legal_name: 'Stahlhandel Nord GmbH', street: 'Hafenstraße 9', postal_code: '20457', city: 'Hamburg', vat_id: 'DE811111111',
    tax_number: '22/333/44444', iban: 'DE89370400440532013000', email: 'rechnung@stahl-nord.de', phone: '+49 40 1',
  }).expect(200);

  // Buyer: has the seller as supplier and a purchase order
  buyer = await t.companyWithAdmin('KAEUFER');
  accounting = await t.userClient(buyer.api, 'KAEUFER', 'FIBU', 'accounting');
  planner = await t.userClient(buyer.api, 'KAEUFER', 'DISPO', 'material_planner');
  supplierId = (await buyer.api.post('/api/suppliers', { name: 'Stahlhandel Nord', vat_number: 'DE 811 111 111' })).body.id;
  const steel = await t.createItem(buyer.api, 'STAHL', 'raw_material', { acquisition_cost: 2 });
  poId = (await buyer.api.post('/api/procurement/purchase-orders', { supplier_id: supplierId, items: [{ item_id: steel, quantity_ordered: 100, unit_price: 2.5 }] })).body.id;

  const customer = (await seller.api.post('/api/customers', { name: 'Käufer Maschinenbau GmbH', street: 'Allee 1', postal_code: '01067', city: 'Dresden', email: 'ap@kaeufer.de' })).body;
  const d = await seller.api.post('/api/sales', {
    doc_type: 'invoice', customer_id: customer.id, customer_reference: `PO-${poId}`,
    lines: [{ description: 'Flachstahl S235', quantity: 100, unit: 'kg', unit_price: 2.5 }, { description: 'Zuschnitt', quantity: 1, unit: 'psch', unit_price: 30 }],
  });
  issued = (await seller.api.post(`/api/sales/${d.body.id}/issue`)).body;
  const full = (await seller.api.get(`/api/sales/${issued.id}`)).body;
  for (const f of full.files) {
    const buf = (await binary(seller.api.get(`/api/sales/${issued.id}/files/${f.id}`))).body;
    if (f.kind === 'zugferd') zugferd = buf; else xrechnung = buf;
  }
});
after(t.teardown);

describe('receiving', () => {
  let received;

  test('a ZUGFeRD PDF is read, matched to supplier and purchase order', async () => {
    const res = await upload(planner.api, zugferd, 'Rechnung.pdf');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    received = res.body;
    assert.equal(received.format, 'ZUGFeRD/Factur-X (CII)');
    assert.equal(received.invoice_number, issued.number);
    assert.equal(received.seller_vat_id, 'DE811111111');
    assert.equal(received.gross_total, 333.2); // (250 + 30) × 1.19
    assert.equal(received.supplier_id, supplierId);
    assert.equal(received.po_id, poId);
    assert.deepEqual(received.warnings, []);
    assert.equal(received.invoice.lines.length, 2);
    assert.equal(received.invoice.lines[0].unit, 'KGM');
    assert.equal(received.invoice.seller.iban, undefined); // IBAN is on the invoice level
    assert.equal(received.invoice.iban, 'DE89370400440532013000');
  });

  test('the same invoice again (also as XML) is recognised as duplicate', async () => {
    const again = await upload(planner.api, zugferd, 'Rechnung.pdf');
    assert.equal(again.status, 409);
    assert.equal(again.body.existing_id, received.id);
    assert.equal((await upload(planner.api, xrechnung, 'Rechnung.xml')).status, 409);
  });

  test('details show the purchase order for comparison; the original is archived unchanged', async () => {
    const res = await planner.api.get(`/api/purchase-invoices/${received.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.purchase_order.net_total, 250);
    assert.equal(res.body.supplier_name, 'Stahlhandel Nord');
    const orig = await binary(planner.api.get(`/api/purchase-invoices/${received.id}/original`));
    assert.equal(crypto.createHash('sha256').update(orig.body).digest('hex'), crypto.createHash('sha256').update(zugferd).digest('hex'));
    await assert.rejects(
      t.db.withContext({ companyId: buyer.company.id }, () => t.db.run('UPDATE purchase_invoices SET gross_total = 1 WHERE id = ?', [received.id])),
      /cannot be changed/,
    );
    await assert.rejects(
      t.db.withContext({ companyId: buyer.company.id }, () => t.db.run('DELETE FROM purchase_invoices WHERE id = ?', [received.id])),
      /cannot be deleted/,
    );
  });

  test('approval workflow: only accounting decides; invalid transitions are refused', async () => {
    assert.equal((await planner.api.post(`/api/purchase-invoices/${received.id}/status`, { status: 'approved' })).status, 403);
    assert.equal((await accounting.api.post(`/api/purchase-invoices/${received.id}/status`, { status: 'paid' })).status, 400);
    assert.equal((await accounting.api.post(`/api/purchase-invoices/${received.id}/status`, { status: 'approved', notes: 'Preise geprüft' })).status, 200);
    assert.equal((await accounting.api.post(`/api/purchase-invoices/${received.id}/status`, { status: 'paid' })).status, 200);
    const list = await accounting.api.get('/api/purchase-invoices?status=paid');
    assert.equal(list.body.length, 1);
  });

  test('other companies cannot see received invoices', async () => {
    assert.equal((await seller.api.get('/api/purchase-invoices')).body.length, 0);
    assert.equal((await seller.api.get(`/api/purchase-invoices/${received.id}`)).status, 404);
  });
});

describe('formats and problems', () => {
  test('XRechnung in UBL syntax is read too; unknown seller can be created as supplier', async () => {
    const company = { name: 'Fremd AG', legal_name: 'Fremd AG', street: 'Weg 5', postal_code: '60311', city: 'Frankfurt', country: 'DE', vat_id: 'DE822222222', email: 'r@fremd.de', phone: '1' };
    const doc = {
      doc_type: 'invoice', number: 'F-2026-7', document_date: '2026-10-01', due_date: '2026-10-15', currency: 'EUR',
      customer_name: 'Käufer', customer_country: 'DE', tax_total: 19, net_total: 100, gross_total: 119, service_date: '2026-10-01',
      tax_breakdown: [{ tax_category: 'S', tax_rate: 19, net_amount: 100, tax_amount: 19 }],
      lines: [{ position: 1, quantity: 4, unit: 'Stk', unit_price: 25, line_net: 100, discount_percent: 0, tax_rate: 19, tax_category: 'S', description: 'Ventil' }],
    };
    const data = einvoice.buildInvoiceData(doc, company, { street: 'Allee 1', city: 'Dresden', postal_code: '01067', email: 'ap@kaeufer.de' });
    const ubl = await new (require('@e-invoice-eu/core').InvoiceService)({ log() {}, warn() {}, error() {} }).generate(data, { format: 'XRECHNUNG-UBL', lang: 'de-de' });
    const res = await upload(planner.api, Buffer.from(ubl), 'fremd.xml');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.format, 'XRechnung (UBL)');
    assert.equal(res.body.gross_total, 119);
    assert.equal(res.body.supplier_id, null);
    assert.deepEqual(res.body.warnings, []);

    const created = await planner.api.post(`/api/purchase-invoices/${res.body.id}/create-supplier`);
    assert.equal(created.status, 201);
    const sup = (await buyer.api.get('/api/suppliers')).body.find((s) => s.id === created.body.supplier_id);
    assert.equal(sup.vat_number, 'DE822222222');
    assert.equal((await planner.api.get(`/api/purchase-invoices/${res.body.id}`)).body.supplier_id, created.body.supplier_id);
  });

  test('totals that do not add up are accepted with warnings', async () => {
    const xml = xrechnung.toString('utf8')
      .replace(/<ram:ID>RE-/, '<ram:ID>X-RE-')
      .replace(/<ram:GrandTotalAmount>[^<]+</, '<ram:GrandTotalAmount>999.99<');
    const res = await upload(planner.api, Buffer.from(xml), 'falsch.xml');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.warnings.some((w) => /does not equal the gross total/.test(w)), JSON.stringify(res.body.warnings));
  });

  test('a plain PDF without e-invoice data is refused with an explanation', async () => {
    const d = await seller.api.post('/api/sales', { doc_type: 'quote', customer_id: (await seller.api.get('/api/customers')).body[0].id, lines: [{ description: 'x', quantity: 1, unit_price: 1 }] });
    const pdf = (await binary(seller.api.get(`/api/sales/${d.body.id}/pdf`))).body;
    const res = await upload(planner.api, pdf, 'angebot.pdf');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /no e-invoice data/);
  });

  test('other files are refused', async () => {
    assert.equal((await upload(planner.api, Buffer.from('hello'), 'x.txt')).status, 400);
    assert.equal((await upload(planner.api, Buffer.from('<note>x</note>'), 'x.xml')).status, 400);
    assert.equal((await planner.api.post('/api/purchase-invoices', { filename: 'x', content_base64: '' })).status, 400);
  });

  test('uploaded file contents are not copied into the audit log', async () => {
    const logs = await t.db.withContext({ companyId: buyer.company.id }, () =>
      t.db.all("SELECT new_data FROM audit_logs WHERE entity = 'purchase-invoices'"));
    assert.ok(logs.length > 0);
    assert.ok(logs.every((l) => l.new_data.length < 2000 && !l.new_data.includes('JVBERi')));
  });
});
