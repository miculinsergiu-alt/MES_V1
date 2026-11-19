/**
 * Attachments (files on records, revisions) and material certificates
 * (EN 10204) along the batch trace into a certificate pack per delivery note.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const t = require('./helpers');

let c; let other; let machine; let raw; let fg; let bomId; let customer; let orderId; let delivery; let lotR1;

const pdfBase64 = async (text) => {
  const d = await PDFDocument.create();
  d.addPage([200, 200]).drawText(text, { x: 10, y: 100, size: 12 });
  return Buffer.from(await d.save()).toString('base64');
};
const binary = (req) => req.buffer(true).parse((res, cb) => {
  const chunks = []; res.on('data', (x) => chunks.push(x)); res.on('end', () => cb(null, Buffer.concat(chunks)));
});

before(async () => {
  await t.setup();
  c = await t.companyWithAdmin('CERT');
  other = await t.companyWithAdmin('OTHERCERT');
  machine = await t.createMachine(c.api, 'Drehbank');
  raw = await t.createItem(c.api, 'S355-RD40', 'raw_material', { acquisition_cost: 2 });
  await c.api.put(`/api/items/${raw}`, { requires_certificate: 1 }).expect(200);
  fg = await t.createItem(c.api, 'WELLE-40', 'finished_good', { unit_price: 20 });
  bomId = (await c.api.post('/api/boms', { parent_item_id: fg, name: 'Welle', tree: [{ item_id: raw, quantity: 1, node_type: 'component' }] })).body.id;
  await c.api.put('/api/settings/company', { legal_name: 'Cert GmbH', street: 'Weg 1', postal_code: '10115', city: 'Berlin', vat_id: 'DE123456789' }).expect(200);
  customer = (await c.api.post('/api/customers', { name: 'Maschinenbau AG', street: 'Str. 1', postal_code: '80331', city: 'München', requires_certificates: 1 })).body;
  await c.api.post('/api/procurement/receipts', { items: [{ item_id: raw, lot_number: 'R1', quantity_received: 10 }] }).expect(200);
  lotR1 = (await c.api.get('/api/trace?q=R1')).body.find((l) => l.lot_number === 'R1').id;
  orderId = (await c.api.post('/api/orders', { orders: [{ machine_id: machine, item_id: fg, bom_id: bomId, quantity: 5, planned_start: '2030-01-05 08:00' }] })).body.created[0].id;
  await c.api.post('/api/production/results', { order_id: orderId, qty_ok: 5 }).expect(201);
  const d = await c.api.post('/api/sales', { doc_type: 'delivery', customer_id: customer.id, lines: [{ item_id: fg, quantity: 3 }] });
  await c.api.post(`/api/sales/${d.body.id}/issue`, {}).expect(200);
  delivery = d.body.id;
});
after(t.teardown);

describe('attachments', () => {
  test('upload checks owner, type and content; operators can read but not upload', async () => {
    const content = await pdfBase64('Zeugnis');
    await c.api.post('/api/attachments', { owner_type: 'lot', owner_id: 99999, kind: 'certificate', filename: 'x.pdf', content_base64: content }).expect(404);
    // a text file pretending to be a PDF
    const fake = await c.api.post('/api/attachments', { owner_type: 'lot', owner_id: lotR1, kind: 'certificate', filename: 'x.pdf', content_base64: Buffer.from('hello').toString('base64') });
    assert.equal(fake.status, 400);
    await c.api.post('/api/attachments', { owner_type: 'lot', owner_id: lotR1, kind: 'certificate', filename: 'x.exe', mime_type: 'application/x-msdownload', content_base64: content }).expect(400);
    const op = await t.userClient(c.api, 'CERT', 'OP1', 'operator');
    await op.api.post('/api/attachments', { owner_type: 'item', owner_id: fg, kind: 'drawing', revision: 'A', filename: 'z.pdf', content_base64: content }).expect(403);
  });

  test('drawings keep a revision history; only the newest is current', async () => {
    const up = (rev) => c.api.post('/api/attachments', { owner_type: 'item', owner_id: fg, kind: 'drawing', revision: rev, filename: `welle-${rev}.pdf`, content_base64: Buffer.from('%PDF-1.4 test').toString('base64') });
    await c.api.post('/api/attachments', { owner_type: 'item', owner_id: fg, kind: 'drawing', filename: 'w.pdf', content_base64: Buffer.from('%PDF-1.4').toString('base64') }).expect(400); // revision missing
    const a = (await up('A').expect(201)).body;
    const b = (await up('B').expect(201)).body;
    await up('B').expect(400); // duplicate revision
    const current = (await c.api.get(`/api/attachments?owner_type=item&owner_id=${fg}&kind=drawing`)).body;
    assert.deepEqual(current.map((x) => x.revision), ['B']);
    const all = (await c.api.get(`/api/attachments?owner_type=item&owner_id=${fg}&kind=drawing&all_revisions=1`)).body;
    assert.deepEqual(all.map((x) => x.revision), ['B', 'A']);
    // deleting the wrong upload makes the previous revision current again
    await c.api.delete(`/api/attachments/${b.id}`).expect(200);
    assert.deepEqual((await c.api.get(`/api/attachments?owner_type=item&owner_id=${fg}&kind=drawing`)).body.map((x) => x.id), [a.id]);
  });

  test('files of other companies are invisible', async () => {
    const list = (await c.api.get(`/api/attachments?owner_type=item&owner_id=${fg}&all_revisions=1`)).body;
    await other.api.get(`/api/attachments/${list[0].id}/file`).expect(404);
    assert.equal((await other.api.get(`/api/attachments?owner_type=item&owner_id=${fg}`)).body.length, 0);
  });
});

describe('material certificates', () => {
  test('a delivery without certificates for certified material reports what is missing', async () => {
    const pack = (await c.api.get(`/api/trace/delivery/${delivery}/certificates`).expect(200)).body;
    assert.equal(pack.customer_requires_certificates, true);
    assert.equal(pack.lines.length, 1);
    assert.equal(pack.lines[0].lot.lot_number, `FA-${orderId}`);
    assert.deepEqual(pack.lines[0].materials.map((m) => m.lot_number), ['R1']);
    assert.equal(pack.missing_count, 1);
  });

  test('a 3.1 certificate on the material lot travels to the delivery; the pack is one PDF', async () => {
    const cert = await c.api.post('/api/attachments', {
      owner_type: 'lot', owner_id: lotR1, kind: 'certificate', filename: 'APZ-3.1-R1.pdf', heat_number: 'S123456',
      content_base64: await pdfBase64('EN 10204 3.1 Heat S123456'),
    });
    assert.equal(cert.status, 201, JSON.stringify(cert.body));
    assert.equal(cert.body.cert_type, '3.1');

    const pack = (await c.api.get(`/api/trace/delivery/${delivery}/certificates`)).body;
    assert.equal(pack.missing_count, 0);
    assert.equal(pack.lines[0].certificates[0].heat_number, 'S123456');

    const pdf = await c.api.get(`/api/trace/delivery/${delivery}/certificates.pdf`).use(binary).expect(200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    const doc = await PDFDocument.load(pdf.body);
    assert.equal(doc.getPageCount(), 2); // cover sheet + the certificate
  });

  test('other companies cannot read the pack', async () => {
    await other.api.get(`/api/trace/delivery/${delivery}/certificates`).expect(404);
  });
});
