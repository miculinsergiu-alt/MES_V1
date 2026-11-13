/**
 * PDFs and e-invoices: archived on issue, ZUGFeRD (PDF/A-3 + XML) and
 * XRechnung content, credit note references, write-once archive.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const t = require('./helpers');
const { unitCode } = require('../services/einvoice');

let c; let customer; let item;

const binary = (req) => req.buffer(true).parse((res, cb) => {
  const chunks = [];
  res.on('data', (x) => chunks.push(x));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});

/** Text of all (also compressed) parts of a PDF, for structure checks. */
function pdfText(buf) {
  const s = buf.toString('latin1');
  let text = s;
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    try { text += zlib.inflateSync(buf.subarray(start, end)).toString('latin1'); } catch { /* not deflated */ }
  }
  return text;
}

async function issuedInvoice(extra = {}) {
  const d = await c.api.post('/api/sales', {
    doc_type: 'invoice', customer_id: customer.id, customer_reference: 'PO-77',
    lines: [{ item_id: item, quantity: 3 }, { description: 'Montage', quantity: 2.5, unit: 'h', unit_price: 80, discount_percent: 10 }],
    ...extra,
  });
  const r = await c.api.post(`/api/sales/${d.body.id}/issue`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (await c.api.get(`/api/sales/${d.body.id}`)).body;
}

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('DOCS');
  await c.api.put('/api/settings/company', {
    legal_name: 'Docs GmbH', street: 'Werkstraße 1', postal_code: '70173', city: 'Stuttgart', vat_id: 'DE999999999',
    iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', email: 'rechnung@docs.de', phone: '+49 711 123',
  }).expect(200);
  item = await t.createItem(c.api, 'P-1', 'finished_good', { unit_price: 99.99 });
  customer = (await c.api.post('/api/customers', { name: 'Kunde AG', street: 'Allee 2', postal_code: '50667', city: 'Köln', email: 'ap@kunde.de' })).body;
});
after(t.teardown);

test('issuing an invoice archives a ZUGFeRD PDF and an XRechnung XML', async () => {
  const inv = await issuedInvoice();
  assert.deepEqual(inv.files.map((f) => f.kind).sort(), ['xrechnung', 'zugferd']);
  for (const f of inv.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
  const v = await c.api.get(`/api/sales/${inv.id}/verify`);
  assert.deepEqual([v.body.content_unchanged, v.body.files_unchanged], [true, true]);
});

test('ZUGFeRD PDF: PDF/A-3 with embedded factur-x.xml (EN 16931 profile)', async () => {
  const inv = await issuedInvoice();
  const res = await binary(c.api.get(`/api/sales/${inv.id}/pdf`));
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  const text = pdfText(res.body);
  assert.ok(res.body.subarray(0, 5).toString() === '%PDF-');
  assert.match(text, /factur-x\.xml/);
  assert.match(text, /<pdfaid:part>3<\/pdfaid:part>|pdfaid:part="3"/);
  assert.match(text, /ConformanceLevel>EN 16931</);
  assert.match(text, /\/AFRelationship \/Alternative/);
  assert.match(text, /\/OutputIntent/);
  assert.match(text, /\/FontFile2/, 'fonts must be embedded for PDF/A');
});

test('XRechnung XML contains the invoice data', async () => {
  const inv = await issuedInvoice();
  const file = inv.files.find((f) => f.kind === 'xrechnung');
  const res = await binary(c.api.get(`/api/sales/${inv.id}/files/${file.id}`));
  const xml = res.body.toString('utf8');
  assert.match(xml, /urn:cen\.eu:en16931:2017#compliant#urn:xeinkauf\.de:kosit:xrechnung_3\.0/);
  assert.match(xml, new RegExp(`<ram:ID>${inv.number}</ram:ID>`));
  assert.match(xml, /<ram:TypeCode>380<\/ram:TypeCode>/);
  assert.match(xml, /<ram:BuyerReference>PO-77<\/ram:BuyerReference>/);
  assert.match(xml, /<ram:IBANID>DE89370400440532013000<\/ram:IBANID>/);
  assert.match(xml, /unitCode="HUR"/);
  assert.match(xml, /unitCode="H87"/);
  // 3 × 99.99 = 299.97; 2.5 h × 80 € − 10 % = 180.00; net 479.97; VAT 19 % = 91.19; gross 571.16
  assert.match(xml, /<ram:TaxBasisTotalAmount>479\.97<\/ram:TaxBasisTotalAmount>/);
  assert.match(xml, /<ram:TaxTotalAmount currencyID="EUR">91\.19<\/ram:TaxTotalAmount>/);
  assert.match(xml, /<ram:GrandTotalAmount>571\.16<\/ram:GrandTotalAmount>/);
  assert.match(xml, /<ram:DuePayableAmount>571\.16<\/ram:DuePayableAmount>/);
});

test('credit note e-invoice: type 381 and reference to the original invoice', async () => {
  const inv = await issuedInvoice();
  const cn = await c.api.post(`/api/sales/${inv.id}/convert`, { target: 'credit_note' });
  const issued = await c.api.post(`/api/sales/${cn.body.id}/issue`);
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  const full = (await c.api.get(`/api/sales/${cn.body.id}`)).body;
  const file = full.files.find((f) => f.kind === 'xrechnung');
  const xml = (await binary(c.api.get(`/api/sales/${cn.body.id}/files/${file.id}`))).body.toString('utf8');
  assert.match(xml, /<ram:TypeCode>381<\/ram:TypeCode>/);
  assert.match(xml, new RegExp(`<ram:InvoiceReferencedDocument>\\s*<ram:IssuerAssignedID>${inv.number}</ram:IssuerAssignedID>`));
});

test('no XRechnung when the stricter German rules cannot be met (ZUGFeRD is still created)', async () => {
  const noMail = (await c.api.post('/api/customers', { name: 'Ohne Mail GmbH', street: 'Weg 3', postal_code: '01067', city: 'Dresden' })).body;
  const d = await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: noMail.id, lines: [{ item_id: item, quantity: 1 }] });
  await c.api.post(`/api/sales/${d.body.id}/issue`).expect(200);
  const full = (await c.api.get(`/api/sales/${d.body.id}`)).body;
  assert.deepEqual(full.files.map((f) => f.kind), ['zugferd']);
});

test('other documents get a PDF; drafts have a live preview', async () => {
  const d = await c.api.post('/api/sales', { doc_type: 'delivery', customer_id: customer.id, lines: [{ item_id: item, quantity: 1 }] });
  const preview = await binary(c.api.get(`/api/sales/${d.body.id}/pdf`));
  assert.equal(preview.status, 200);
  assert.match(preview.headers['content-disposition'], /Entwurf/);
  await c.api.post(`/api/sales/${d.body.id}/issue`).expect(200);
  const full = (await c.api.get(`/api/sales/${d.body.id}`)).body;
  assert.deepEqual(full.files.map((f) => f.kind), ['pdf']);
});

test('archived files cannot be changed or deleted', async () => {
  await assert.rejects(
    t.db.withContext({ companyId: c.company.id }, () => t.db.run('DELETE FROM document_files')),
    /cannot be changed or deleted/,
  );
});

test('unit names are mapped to UN/ECE codes', () => {
  assert.equal(unitCode('Stk'), 'H87');
  assert.equal(unitCode('kg'), 'KGM');
  assert.equal(unitCode('Std.'), 'HUR');
  assert.equal(unitCode('m²'), 'MTK');
  assert.equal(unitCode('psch'), 'LS');
  assert.equal(unitCode('XYZ'), 'XYZ');
  assert.equal(unitCode('Kiste'), 'C62');
});
