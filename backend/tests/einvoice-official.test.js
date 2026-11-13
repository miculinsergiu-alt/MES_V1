/**
 * Validates generated e-invoices with the official tools (KoSIT validator with
 * the XRechnung configuration, Mustang for ZUGFeRD/PDF-A-3), for every tax case.
 *
 * Runs only when the tools are installed (see scripts/validate-einvoices.js);
 * otherwise the test is skipped.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const t = require('./helpers');

const TOOLS = path.resolve(process.env.NOVA_TOOLS || path.join(__dirname, '..', '..', '..', 'nova-tools'));
const available = ['kosit-validator.jar', 'mustang-cli.jar', 'xrechnung-config'].every((f) => fs.existsSync(path.join(TOOLS, f)));

const binary = (req) => req.buffer(true).parse((res, cb) => {
  const chunks = [];
  res.on('data', (x) => chunks.push(x));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});

let dir;
const files = [];

before(async () => {
  if (!available) return;
  await t.setup();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-einv-'));
  const settings = {
    legal_name: 'Prüf GmbH', street: 'Teststraße 1', postal_code: '10115', city: 'Berlin', vat_id: 'DE123456789',
    tax_number: '11/222/33333', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', email: 'rechnung@pruef.de', phone: '+49 30 123',
    register_court: 'Amtsgericht Berlin', register_number: 'HRB 1', managing_directors: 'Erika Muster',
  };
  const c = await t.companyWithAdmin('OFFICIAL');
  await c.api.put('/api/settings/company', settings).expect(200);
  const item = await t.createItem(c.api, 'P-1', 'finished_good', { unit_price: 19.99 });
  const customers = {
    domestic: { name: 'Inland GmbH', street: 'Weg 1', postal_code: '50667', city: 'Köln', email: 'a@inland.de', skonto_days: 10, skonto_percent: 3 },
    intra_eu: { name: 'Bruxelles SA', street: 'Rue 1', postal_code: '1000', city: 'Bruxelles', country: 'BE', vat_id: 'BE0123456789', email: 'b@be.be' },
    export: { name: 'Zürich AG', street: 'Strasse 1', postal_code: '8001', city: 'Zürich', country: 'CH', email: 'c@ch.ch' },
  };
  const lines = [
    { item_id: item, quantity: 7 },
    { description: 'Montage\nvor Ort', quantity: 2.25, unit: 'h', unit_price: 72.5, discount_percent: 10 },
    { description: 'Handbuch', quantity: 1, unit_price: 12.34, tax_rate: 7 },
  ];
  let firstInvoice;
  for (const [key, body] of Object.entries(customers)) {
    const cust = (await c.api.post('/api/customers', body)).body;
    const d = await c.api.post('/api/sales', { doc_type: 'invoice', customer_id: cust.id, customer_reference: 'PO-1', lines });
    const r = await c.api.post(`/api/sales/${d.body.id}/issue`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    firstInvoice ||= r.body;
    files.push(...await download(c.api, r.body.id, key));
  }
  const cn = await c.api.post(`/api/sales/${firstInvoice.id}/convert`, { target: 'credit_note' });
  await c.api.post(`/api/sales/${cn.body.id}/issue`).expect(200);
  files.push(...await download(c.api, cn.body.id, 'credit_note'));

  const k = await t.companyWithAdmin('OFFKLEIN');
  await k.api.put('/api/settings/company', { ...settings, vat_id: '', small_business: 1 }).expect(200);
  const kc = (await k.api.post('/api/customers', { name: 'Privat', street: 'Weg 2', postal_code: '80333', city: 'München', email: 'p@example.de' })).body;
  const kd = await k.api.post('/api/sales', { doc_type: 'invoice', customer_id: kc.id, lines: [{ description: 'Arbeit', quantity: 3, unit: 'h', unit_price: 45 }] });
  await k.api.post(`/api/sales/${kd.body.id}/issue`).expect(200);
  files.push(...await download(k.api, kd.body.id, 'small_business'));

  async function download(api, id, label) {
    const full = (await api.get(`/api/sales/${id}`)).body;
    const out = [];
    for (const f of full.files) {
      const res = await binary(api.get(`/api/sales/${id}/files/${f.id}`));
      const p = path.join(dir, `${label}__${f.filename}`);
      fs.writeFileSync(p, res.body);
      out.push(p);
    }
    return out;
  }
});

after(async () => {
  if (!available) return;
  await t.teardown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('official validators accept all generated e-invoices', { skip: !available && 'validators not installed', timeout: 600000 }, () => {
  assert.equal(files.length, 10); // 5 documents × (ZUGFeRD PDF + XRechnung XML)
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'validate-einvoices.js'), ...files], { encoding: 'utf8', env: { ...process.env, NOVA_TOOLS: TOOLS } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal((r.stdout.match(/^VALID/gm) || []).length, 10, r.stdout);
});
