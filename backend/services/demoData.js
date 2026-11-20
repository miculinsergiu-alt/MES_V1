/**
 * Fills the DEMO company with data that looks like a small working job shop:
 * master data, purchasing, stock in lots, quotes, orders, production with reported
 * results, deliveries, invoices, payments and an overdue invoice.
 *
 * Everything goes through the real HTTP API (on a temporary local server), so the
 * data follows the same business rules as data entered by hand.
 * Call it only outside of a request (e.g. at server start), never inside one.
 */
const { createServer } = require('node:http');

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysFromNow = (n) => isoDate(new Date(Date.now() + n * DAY));
const at = (days, hour) => `${daysFromNow(days)} ${pad(hour)}:00`;

function client(base, token) {
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`Demo data: ${method} ${url} -> ${res.status} ${text.slice(0, 300)}`);
    return data;
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b ?? {}),
    put: (u, b) => call('PUT', u, b ?? {}),
  };
}

async function login(base, code, badge, password) {
  const res = await client(base).post('/api/auth/login', { company_code: code, badge_number: badge, password });
  return client(base, res.token);
}

/** Runs fn(baseUrl) against the app on a temporary local port. */
async function withLocalServer(app, fn) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function populateDemo(app, { code, password }) {
  return withLocalServer(app, async (base) => {
    const admin = await login(base, code, 'ADMIN001', password);

    // ── Company and users ───────────────────────────────────────────────
    await admin.put('/api/settings/company', {
      legal_name: 'NOVA Demo GmbH', street: 'Industriestraße 14', postal_code: '87437', city: 'Kempten (Allgäu)',
      vat_id: 'DE111111111', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bank_name: 'Demo Bank',
      phone: '+49 831 000000', email: 'info@nova-demo.example', managing_directors: 'Max Mustermann',
      register_court: 'Amtsgericht Kempten', register_number: 'HRB 00000', tax_number: '127/000/00000',
      default_payment_terms_days: 30, dunning_fee: 5, dunning_grace_days: 3, labor_rate: 52,
    });
    const users = await admin.get('/api/users');
    const userId = (badge) => users.find((u) => u.badge_number === badge).id;
    const sales = await login(base, code, 'VK001', password);
    const acc = await login(base, code, 'FIB001', password);
    const shiftLead = await login(base, code, 'SHR001', password);
    const operators = [['OPR001', await login(base, code, 'OPR001', password)], ['OPR002', await login(base, code, 'OPR002', password)]];

    // ── Machines ────────────────────────────────────────────────────────
    const area = async (name) => (await admin.post('/api/machines/areas', { name })).id;
    const cnc = await area('Zerspanung');
    const sheet = await area('Blechbearbeitung');
    const asm = await area('Montage');
    const machine = async (area_id, name, setup, rate) => (await admin.post('/api/machines', { area_id, name, setup_time_min: setup, hourly_rate: rate })).id;
    const mill = await machine(cnc, 'DMG Mori DMU 50 (5-Achs-Fräsen)', 45, 95);
    const lathe = await machine(cnc, 'Okuma LB3000 (CNC-Drehen)', 30, 85);
    const laser = await machine(sheet, 'Trumpf TruLaser 3030', 15, 120);
    const press = await machine(sheet, 'Trumpf TruBend 5130', 20, 75);
    const bench = await machine(asm, 'Montageplatz 1', 5, 48);

    await admin.post('/api/warehousing/warehouses', { name: 'Hauptlager', type: 'central' });
    await admin.post('/api/warehousing/warehouses', { name: 'Versand', type: 'shipping' });

    // ── Suppliers ───────────────────────────────────────────────────────
    const supplier = async (b) => (await admin.post('/api/suppliers', b)).id;
    const steelSup = await supplier({ name: 'Allgäuer Stahlhandel GmbH', contact_person: 'Herr Berger', email: 'verkauf@stahl-demo.example', address: 'Hafenweg 3, 87700 Memmingen' });
    const aluSup = await supplier({ name: 'Alu-Profil Süd GmbH', contact_person: 'Frau Huber', email: 'info@alu-demo.example', address: 'Werkstraße 8, 88299 Leutkirch' });
    const partsSup = await supplier({ name: 'Normteile Bayern KG', contact_person: 'Herr Maier', email: 'bestellung@normteile-demo.example', address: 'Ring 22, 86150 Augsburg' });
    const coatSup = await supplier({ name: 'Pulverbeschichtung Iller GmbH', contact_person: 'Herr Wagner', email: 'auftrag@beschichtung-demo.example', address: 'Illerstraße 5, 87509 Immenstadt' });

    // ── Items, routings, BOMs ───────────────────────────────────────────
    const item = async (b) => (await admin.post('/api/items', { tax_rate: 19, ...b })).id;
    const alu = await item({ item_code: 'RM-ALU6082-D60', name: 'Rundstab AlMgSi1 (6082) Ø60 mm', type: 'raw_material', uom: 'kg', acquisition_cost: 5.8, lead_time_days: 5 });
    const c45 = await item({ item_code: 'RM-C45-D40', name: 'Rundstab C45 Ø40 mm', type: 'raw_material', uom: 'kg', acquisition_cost: 2.1, lead_time_days: 4 });
    const s235 = await item({ item_code: 'RM-S235-3MM', name: 'Stahlblech S235JR 3 mm', type: 'raw_material', uom: 'kg', acquisition_cost: 1.35, lead_time_days: 3 });
    const screw = await item({ item_code: 'NT-M8X20', name: 'Sechskantschraube ISO 4017 M8x20, verzinkt', type: 'raw_material', acquisition_cost: 0.06 });
    const nut = await item({ item_code: 'NT-M8', name: 'Sechskantmutter ISO 4032 M8', type: 'raw_material', acquisition_cost: 0.03 });
    const bush = await item({ item_code: 'NT-GLB-2020', name: 'Gleitlagerbuchse 20x23x20', type: 'raw_material', acquisition_cost: 1.2 });

    const flange = await item({
      item_code: 'FL-6082-120', name: 'Lagerflansch Ø120, Alu eloxiert', type: 'finished_good', unit_price: 48.5, production_time_min: 12,
      routes: [{ machine_id: lathe, process_time_min: 6, setup_time_min: 30 }, { machine_id: mill, process_time_min: 6, setup_time_min: 45 },
        { step_type: 'external', supplier_id: coatSup, external_days: 5, external_price: 3.2 }],
    });
    const shaft = await item({
      item_code: 'WE-C45-250', name: 'Antriebswelle C45, Länge 250 mm', type: 'finished_good', unit_price: 36.9, production_time_min: 9,
      routes: [{ machine_id: lathe, process_time_min: 9, setup_time_min: 30 }],
    });
    const bracket = await item({
      item_code: 'WB-S235-100', name: 'Winkelblech 100x50, gekantet', type: 'semi_finished', production_cost: 2.4,
      routes: [{ machine_id: laser, process_time_min: 2, setup_time_min: 15 }, { machine_id: press, process_time_min: 1, setup_time_min: 20 }],
    });
    const holder = await item({
      item_code: 'HG-200', name: 'Halterung HG-200, montiert', type: 'finished_good', unit_price: 24.9, production_time_min: 3,
      routes: [{ machine_id: bench, process_time_min: 3, setup_time_min: 5 }],
    });
    const housing = await item({
      item_code: 'GH-6082-80', name: 'Sensorgehäuse 80x60, gefräst', type: 'finished_good', unit_price: 89, production_time_min: 22,
      routes: [{ machine_id: mill, process_time_min: 22, setup_time_min: 60 }],
    });
    await item({ item_code: 'DL-KONSTR', name: 'Konstruktion / CAD-Stunde', type: 'finished_good', uom: 'h', unit_price: 85 });

    const bom = (parent_item_id, name, tree) => admin.post('/api/boms', {
      parent_item_id, name, tree: tree.map(([item_id, quantity]) => ({ item_id, quantity, node_type: 'component' })),
    });
    await bom(flange, 'Stückliste Lagerflansch', [[alu, 1.4], [bush, 1]]);
    await bom(shaft, 'Stückliste Antriebswelle', [[c45, 2.6]]);
    await bom(bracket, 'Stückliste Winkelblech', [[s235, 0.35]]);
    await bom(holder, 'Stückliste Halterung', [[bracket, 2], [screw, 4], [nut, 4]]);
    await bom(housing, 'Stückliste Sensorgehäuse', [[alu, 1.1]]);

    // ── Purchasing: received, partly received and open orders ──────────
    const po = async (supplier_id, expected, items) => (await admin.post('/api/procurement/purchase-orders', {
      supplier_id, expected_date: daysFromNow(expected),
      items: items.map(([item_id, quantity_ordered, unit_price]) => ({ item_id, quantity_ordered, unit_price })),
    })).id;
    const receive = (po_id, ref, items) => admin.post('/api/procurement/receipts', {
      po_id, document_reference: ref,
      items: items.map(([item_id, quantity_received, lot_number]) => ({ item_id, quantity_received, lot_number })),
    });
    const po1 = await po(steelSup, -20, [[c45, 400, 2.1], [s235, 800, 1.32]]);
    await receive(po1, 'LS-24-1187', [[c45, 400, 'CH-C45-2411'], [s235, 800, 'CH-S235-2411']]);
    const po2 = await po(aluSup, -14, [[alu, 600, 5.75]]);
    await receive(po2, 'LS-A-5521', [[alu, 350, 'CH-ALU-5521']]); // partial
    const po3 = await po(partsSup, -10, [[screw, 2000, 0.06], [nut, 2000, 0.03], [bush, 300, 1.15]]);
    await receive(po3, 'LS-NT-889', [[screw, 2000, 'CH-M8-889'], [nut, 2000, 'CH-MU-889'], [bush, 300, 'CH-GLB-889']]);
    await po(steelSup, 6, [[s235, 500, 1.35]]); // open

    // ── Customers ───────────────────────────────────────────────────────
    const customer = async (b) => (await sales.post('/api/customers', { country: 'DE', ...b })).id;
    const custs = {
      kaeser: await customer({ name: 'Allgäu Anlagenbau GmbH', street: 'Bahnhofstraße 21', postal_code: '87435', city: 'Kempten', email: 'einkauf@anlagenbau-demo.example', payment_terms_days: 30 }),
      bodensee: await customer({ name: 'Bodensee Fördertechnik AG', street: 'Seestraße 7', postal_code: '88045', city: 'Friedrichshafen', email: 'beschaffung@foerdertechnik-demo.example', payment_terms_days: 14 }),
      iller: await customer({ name: 'Iller Maschinenbau KG', street: 'Am Werk 3', postal_code: '87700', city: 'Memmingen', email: 'einkauf@iller-demo.example' }),
      tirol: await customer({ name: 'Tiroler Automation GmbH', street: 'Innrain 40', postal_code: '6020', city: 'Innsbruck', country: 'AT', vat_id: 'ATU12345678', email: 'office@tirol-demo.example' }),
      ulm: await customer({ name: 'Donau Medizintechnik GmbH', street: 'Science Park 2', postal_code: '89081', city: 'Ulm', email: 'purchasing@medtech-demo.example' }),
    };

    // ── Sales documents ─────────────────────────────────────────────────
    const draft = (doc_type, customer_id, lines, extra = {}) => sales.post('/api/sales', { doc_type, customer_id, lines, ...extra });
    const issue = (id, body) => sales.post(`/api/sales/${id}/issue`, body);
    const convert = (id, target) => sales.post(`/api/sales/${id}/convert`, { target });

    /** Quote → order (with production) and returns { order, productionIds }. */
    async function orderFlow(customer_id, lines, { quoteDays, startDays, ref }) {
      const q = await draft('quote', customer_id, lines, { document_date: daysFromNow(quoteDays), customer_reference: ref });
      await issue(q.id);
      const o = await convert(q.id, 'order');
      await sales.put(`/api/sales/${o.id}`, { document_date: daysFromNow(Math.min(quoteDays + 3, 0)) });
      const order = await issue(o.id, { create_production: { planned_start: at(startDays, 6) } });
      return { order, productionIds: order.lines.map((l) => l.production_order_id).filter(Boolean) };
    }

    /** Operator reports work and good/scrap parts for a production order. */
    const reasons = await admin.get('/api/production/defect-reasons');
    async function produce(orderId, okShare = 1, opIdx = 0) {
      const prod = await admin.get(`/api/orders/${orderId}`);
      const [badge, op] = operators[opIdx];
      const alloc = await shiftLead.post('/api/production/allocations', {
        order_id: orderId, operator_id: userId(badge), machine_id: prod.machine_id,
        start_time: prod.planned_start.slice(0, 16), end_time: prod.planned_end.slice(0, 16), phase: 'working',
      });
      await op.post('/api/production/actions', { allocation_id: alloc.id, action_type: 'working_start' });
      const qty = Number(prod.quantity);
      const fail = okShare < 1 ? Math.max(1, Math.round(qty * (1 - okShare))) : 0;
      await op.post('/api/production/results', {
        order_id: orderId, qty_ok: qty - fail, qty_fail: fail,
        defects: fail && reasons[0] ? [{ reason_id: reasons[0].id, quantity: fail }] : [],
      });
    }

    async function deliverAndInvoice(order, invoiceDays, { pay } = {}) {
      const d = await convert(order.id, 'delivery');
      await sales.put(`/api/sales/${d.id}`, { document_date: daysFromNow(invoiceDays) });
      await issue(d.id);
      const inv = await convert(order.id, 'invoice');
      await sales.put(`/api/sales/${inv.id}`, { document_date: daysFromNow(invoiceDays) });
      const issued = await issue(inv.id);
      if (pay) await acc.post(`/api/sales/${issued.id}/payments`, { payment_date: daysFromNow(invoiceDays + 12), amount: issued.gross_total, reference: 'Überweisung' });
      return issued;
    }

    // 1) Finished, delivered, invoiced and paid
    const a = await orderFlow(custs.kaeser, [{ item_id: flange, quantity: 40 }, { item_id: shaft, quantity: 40 }], { quoteDays: -40, startDays: -30, ref: 'BE-4711' });
    for (const id of a.productionIds) await produce(id, 0.97);
    await deliverAndInvoice(a.order, -25, { pay: true });

    // 2) Finished, invoiced, not paid yet (open item)
    const b = await orderFlow(custs.bodensee, [{ item_id: shaft, quantity: 60 }], { quoteDays: -30, startDays: -21, ref: 'PO-88231' });
    for (const id of b.productionIds) await produce(id, 1, 1);
    await deliverAndInvoice(b.order, -8);

    // 3) Overdue invoice with a first reminder
    const c = await orderFlow(custs.iller, [{ item_id: housing, quantity: 12 }], { quoteDays: -75, startDays: -65, ref: 'Bestellung 2026-118' });
    for (const id of c.productionIds) await produce(id, 0.92);
    const overdue = await deliverAndInvoice(c.order, -55);
    await acc.post(`/api/sales/${overdue.id}/dunning`, {}).catch(() => {});

    // 4) Export to Austria (intra-EU), finished and invoiced, paid
    const d = await orderFlow(custs.tirol, [{ item_id: flange, quantity: 25 }], { quoteDays: -20, startDays: -14, ref: 'TA-2026-77' });
    for (const id of d.productionIds) await produce(id, 1);
    await deliverAndInvoice(d.order, -6, { pay: true });

    // 5) Orders in production / planned for the coming days (Gantt, capacity, "today")
    await orderFlow(custs.ulm, [{ item_id: housing, quantity: 30 }], { quoteDays: -6, startDays: 0, ref: 'MT-PO-3391' });
    await orderFlow(custs.kaeser, [{ item_id: holder, quantity: 150 }], { quoteDays: -4, startDays: 1, ref: 'BE-4790' });
    await orderFlow(custs.bodensee, [{ item_id: shaft, quantity: 80 }, { item_id: flange, quantity: 20 }], { quoteDays: -3, startDays: 2, ref: 'PO-88410' });

    // 6) Open quotes (one draft) and a declined one
    const q1 = await draft('quote', custs.iller, [{ item_id: flange, quantity: 100 }, { description: 'Prüfprotokoll / Erstmusterprüfbericht', quantity: 1, unit: 'psch', unit_price: 120 }], { document_date: daysFromNow(-2) });
    await issue(q1.id);
    await draft('quote', custs.ulm, [{ item_id: housing, quantity: 200, discount_percent: 5 }, { description: 'Konstruktion / CAD-Stunde', quantity: 6, unit: 'h', unit_price: 85 }]);
    const q3 = await draft('quote', custs.tirol, [{ item_id: shaft, quantity: 500, discount_percent: 8 }], { document_date: daysFromNow(-18) });
    await issue(q3.id);
    await sales.post(`/api/sales/${q3.id}/status`, { status: 'declined' }).catch(() => {});

    return { customers: Object.keys(custs).length, orders: 7 };
  });
}

module.exports = { populateDemo };
