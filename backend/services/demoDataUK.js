/**
 * Fills the UKDEMO company (UK job shop: GB VAT 20 %, GBP, English documents) with data that looks like a small working job shop:
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
      country: 'GB', vat_id: 'GB123456789', legal_name: 'NOVA Demo Engineering Ltd', street: 'Unit 4, Tyburn Trading Estate', postal_code: 'B24 8HJ', city: 'Birmingham',
      iban: 'GB29NWBK60161331926819', bic: 'NWBKGB2L', bank_name: 'Demo Bank',
      phone: '+44 121 000 0000', email: 'info@nova-demo.example', managing_directors: 'John Smith',
      register_court: 'Companies House', register_number: '00000000', tax_number: '',
      default_payment_terms_days: 30, dunning_fee: 5, dunning_grace_days: 3, labor_rate: 38,
    });
    const users = await admin.get('/api/users');
    const userId = (badge) => users.find((u) => u.badge_number === badge).id;
    const sales = await login(base, code, 'VK001', password);
    const acc = await login(base, code, 'FIB001', password);
    const shiftLead = await login(base, code, 'SHR001', password);
    const operators = [['OPR001', await login(base, code, 'OPR001', password)], ['OPR002', await login(base, code, 'OPR002', password)]];

    // ── Machines ────────────────────────────────────────────────────────
    const area = async (name) => (await admin.post('/api/machines/areas', { name })).id;
    const cnc = await area('CNC Machining');
    const sheet = await area('Sheet Metal');
    const asm = await area('Assembly');
    const machine = async (area_id, name, setup, rate) => (await admin.post('/api/machines', { area_id, name, setup_time_min: setup, hourly_rate: rate })).id;
    const mill = await machine(cnc, 'DMG Mori DMU 50 (5-axis milling)', 45, 75);
    const lathe = await machine(cnc, 'Haas ST-20 (CNC turning)', 30, 60);
    const laser = await machine(sheet, 'Trumpf TruLaser 3030', 15, 95);
    const press = await machine(sheet, 'Amada HG 1303 press brake', 20, 55);
    const bench = await machine(asm, 'Assembly bench 1', 5, 35);

    await admin.post('/api/warehousing/warehouses', { name: 'Main stores', type: 'central' });
    await admin.post('/api/warehousing/warehouses', { name: 'Dispatch', type: 'shipping' });

    // ── Suppliers ───────────────────────────────────────────────────────
    const supplier = async (b) => (await admin.post('/api/suppliers', b)).id;
    const steelSup = await supplier({ name: 'Midland Steel Stockholders Ltd', contact_person: 'Gary Wilson', email: 'sales@steel-demo.example', address: 'Wednesbury WS10 7LT' });
    const aluSup = await supplier({ name: 'Northern Aluminium Supplies Ltd', contact_person: 'Karen Hughes', email: 'orders@alu-demo.example', address: 'Leeds LS11 5QP' });
    const partsSup = await supplier({ name: 'Black Country Fasteners Ltd', contact_person: 'Dave Clarke', email: 'sales@fasteners-demo.example', address: 'Dudley DY2 0XW' });
    const coatSup = await supplier({ name: 'Coventry Anodising & Coatings Ltd', contact_person: 'Sarah Patel', email: 'jobs@coatings-demo.example', address: 'Coventry CV6 5RS' });

    // ── Items, routings, BOMs ───────────────────────────────────────────
    const item = async (b) => (await admin.post('/api/items', { tax_rate: 20, ...b })).id;
    const alu = await item({ item_code: 'RM-ALU6082-D60', name: 'Aluminium bar 6082-T6 Ø60 mm', type: 'raw_material', uom: 'kg', acquisition_cost: 4.9, lead_time_days: 5 });
    const c45 = await item({ item_code: 'RM-EN8-D40', name: 'Steel bar EN8 (080M40) Ø40 mm', type: 'raw_material', uom: 'kg', acquisition_cost: 1.8, lead_time_days: 4 });
    const s235 = await item({ item_code: 'RM-S235-3MM', name: 'Mild steel sheet S275 3 mm', type: 'raw_material', uom: 'kg', acquisition_cost: 1.15, lead_time_days: 3 });
    const screw = await item({ item_code: 'NT-M8X20', name: 'Hex set screw M8x20, zinc plated', type: 'raw_material', acquisition_cost: 0.06 });
    const nut = await item({ item_code: 'NT-M8', name: 'Hex nut M8', type: 'raw_material', acquisition_cost: 0.03 });
    const bush = await item({ item_code: 'NT-GLB-2020', name: 'Plain bearing bush 20x23x20', type: 'raw_material', acquisition_cost: 1.2 });

    const flange = await item({
      item_code: 'FL-6082-120', name: 'Bearing flange Ø120, anodised aluminium', type: 'finished_good', unit_price: 41.5, production_time_min: 12,
      routes: [{ machine_id: lathe, process_time_min: 6, setup_time_min: 30 }, { machine_id: mill, process_time_min: 6, setup_time_min: 45 },
        { step_type: 'external', supplier_id: coatSup, external_days: 5, external_price: 3.2 }],
    });
    const shaft = await item({
      item_code: 'SH-EN8-250', name: 'Drive shaft EN8, 250 mm long', type: 'finished_good', unit_price: 31.5, production_time_min: 9,
      routes: [{ machine_id: lathe, process_time_min: 9, setup_time_min: 30 }],
    });
    const bracket = await item({
      item_code: 'WB-S235-100', name: 'Angle bracket 100x50, folded', type: 'semi_finished', production_cost: 2.4,
      routes: [{ machine_id: laser, process_time_min: 2, setup_time_min: 15 }, { machine_id: press, process_time_min: 1, setup_time_min: 20 }],
    });
    const holder = await item({
      item_code: 'HG-200', name: 'Mounting bracket HG-200, assembled', type: 'finished_good', unit_price: 21.5, production_time_min: 3,
      routes: [{ machine_id: bench, process_time_min: 3, setup_time_min: 5 }],
    });
    const housing = await item({
      item_code: 'GH-6082-80', name: 'Sensor housing 80x60, milled', type: 'finished_good', unit_price: 76, production_time_min: 22,
      routes: [{ machine_id: mill, process_time_min: 22, setup_time_min: 60 }],
    });
    await item({ item_code: 'DL-KONSTR', name: 'Design / CAD hour', type: 'finished_good', uom: 'h', unit_price: 65 });

    const bom = (parent_item_id, name, tree) => admin.post('/api/boms', {
      parent_item_id, name, tree: tree.map(([item_id, quantity]) => ({ item_id, quantity, node_type: 'component' })),
    });
    await bom(flange, 'BOM bearing flange', [[alu, 1.4], [bush, 1]]);
    await bom(shaft, 'BOM drive shaft', [[c45, 2.6]]);
    await bom(bracket, 'BOM angle bracket', [[s235, 0.35]]);
    await bom(holder, 'BOM mounting bracket', [[bracket, 2], [screw, 4], [nut, 4]]);
    await bom(housing, 'BOM sensor housing', [[alu, 1.1]]);

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
    await receive(po1, 'DN-24-1187', [[c45, 400, 'CH-C45-2411'], [s235, 800, 'CH-S235-2411']]);
    const po2 = await po(aluSup, -14, [[alu, 600, 5.75]]);
    await receive(po2, 'DN-A-5521', [[alu, 350, 'CH-ALU-5521']]); // partial
    const po3 = await po(partsSup, -10, [[screw, 2000, 0.06], [nut, 2000, 0.03], [bush, 300, 1.15]]);
    await receive(po3, 'DN-BCF-889', [[screw, 2000, 'CH-M8-889'], [nut, 2000, 'CH-MU-889'], [bush, 300, 'CH-GLB-889']]);
    await po(steelSup, 6, [[s235, 500, 1.35]]); // open

    // ── Customers ───────────────────────────────────────────────────────
    const customer = async (b) => (await sales.post('/api/customers', { country: 'GB', ...b })).id;
    const custs = {
      kaeser: await customer({ name: 'Midlands Process Equipment Ltd', street: '21 Station Road', postal_code: 'CV1 2GT', city: 'Coventry', email: 'purchasing@mpe-demo.example', payment_terms_days: 30 }),
      bodensee: await customer({ name: 'Severn Conveyor Systems Ltd', street: '7 Riverside Way', postal_code: 'WR5 3HR', city: 'Worcester', email: 'buying@conveyor-demo.example', payment_terms_days: 30 }),
      iller: await customer({ name: 'Pennine Machinery Ltd', street: '3 Mill Lane', postal_code: 'HD1 6QA', city: 'Huddersfield', email: 'orders@pennine-demo.example' }),
      tirol: await customer({ name: 'Celtic Automation Ltd', street: 'Unit 40, Parc Nantgarw', postal_code: 'CF15 7QX', city: 'Cardiff', email: 'office@celtic-demo.example' }),
      ulm: await customer({ name: 'Thames Medical Devices Ltd', street: '2 Science Park', postal_code: 'OX4 4GA', city: 'Oxford', email: 'purchasing@medtech-demo.example' }),
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
      if (pay) await acc.post(`/api/sales/${issued.id}/payments`, { payment_date: daysFromNow(invoiceDays + 12), amount: issued.gross_total, reference: 'BACS' });
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
    const c = await orderFlow(custs.iller, [{ item_id: housing, quantity: 12 }], { quoteDays: -75, startDays: -65, ref: 'PO 2026-118' });
    for (const id of c.productionIds) await produce(id, 0.92);
    const overdue = await deliverAndInvoice(c.order, -55);
    await acc.post(`/api/sales/${overdue.id}/dunning`, {}).catch(() => {});

    // 4) Finished and invoiced, paid
    const d = await orderFlow(custs.tirol, [{ item_id: flange, quantity: 25 }], { quoteDays: -20, startDays: -14, ref: 'TA-2026-77' });
    for (const id of d.productionIds) await produce(id, 1);
    await deliverAndInvoice(d.order, -6, { pay: true });

    // 5) Orders in production / planned for the coming days (Gantt, capacity, "today")
    await orderFlow(custs.ulm, [{ item_id: housing, quantity: 30 }], { quoteDays: -6, startDays: 0, ref: 'MT-PO-3391' });
    await orderFlow(custs.kaeser, [{ item_id: holder, quantity: 150 }], { quoteDays: -4, startDays: 1, ref: 'BE-4790' });
    await orderFlow(custs.bodensee, [{ item_id: shaft, quantity: 80 }, { item_id: flange, quantity: 20 }], { quoteDays: -3, startDays: 2, ref: 'PO-88410' });

    // 6) Open quotes (one draft) and a declined one
    const q1 = await draft('quote', custs.iller, [{ item_id: flange, quantity: 100 }, { description: 'First article inspection report (FAIR)', quantity: 1, unit: 'pc', unit_price: 95 }], { document_date: daysFromNow(-2) });
    await issue(q1.id);
    await draft('quote', custs.ulm, [{ item_id: housing, quantity: 200, discount_percent: 5 }, { description: 'Design / CAD hour', quantity: 6, unit: 'h', unit_price: 65 }]);
    const q3 = await draft('quote', custs.tirol, [{ item_id: shaft, quantity: 500, discount_percent: 8 }], { document_date: daysFromNow(-18) });
    await issue(q3.id);
    await sales.post(`/api/sales/${q3.id}/status`, { status: 'declined' }).catch(() => {});

    return { customers: Object.keys(custs).length, orders: 7 };
  });
}

module.exports = { populateDemo };
