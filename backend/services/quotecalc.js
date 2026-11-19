/**
 * Vorkalkulation (pre-calculation of a quote), zuschlagskalkulation style:
 *
 *   material cost      = BOM quantity × unit cost (moving average / purchase cost)
 * + material surcharge = material × MGK %
 * + machine cost       = (setup + qty × time per piece) × machine hourly rate     per internal step
 * + labour cost        = same hours × company labour rate
 * + outside processing = max(qty × price per piece, minimum charge)              per external step
 * + overhead           = (machine + labour) × overhead %
 * = cost price (Selbstkosten)
 * + margin             = cost × margin %
 * = net price; per piece = net / qty
 *
 * Setup is spread over the batch, so the price per piece falls with quantity.
 * The same item routing and machine rates feed the Nachkalkulation, which makes
 * quoted vs. actual directly comparable.
 */
const db = require('../db');
const { unitCostOf } = require('./stock');

const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const r4 = (x) => Math.round((Number(x) || 0) * 10000) / 10000;

async function inputsFor(itemId) {
  const item = await db.get('SELECT id, item_code, name, uom, unit_price FROM items WHERE id = ?', [itemId]);
  if (!item) return null;
  const bom = await db.get('SELECT id FROM boms WHERE parent_item_id = ? ORDER BY id LIMIT 1', [itemId]);
  const materials = [];
  if (bom) {
    const pos = await db.all(`
      SELECT bp.item_id, SUM(bp.quantity) AS qty, i.item_code, i.name, i.uom
      FROM bom_positions bp JOIN items i ON i.id = bp.item_id
      WHERE bp.bom_id = ? AND bp.node_type = 'component' AND bp.item_id IS NOT NULL
      GROUP BY bp.item_id, i.item_code, i.name, i.uom`, [bom.id]);
    for (const p of pos) materials.push({ item_id: p.item_id, item_code: p.item_code, name: p.name, uom: p.uom, qty_per_piece: Number(p.qty), unit_cost: r4(await unitCostOf(p.item_id)) });
  }
  const steps = await db.all(`
    SELECT ir.sequence, ir.step_type, ir.machine_id, m.name AS machine_name, COALESCE(m.hourly_rate, 0) AS hourly_rate,
           ir.setup_time_min, ir.process_time_min, ir.supplier_id, s.name AS supplier_name,
           ir.external_price, ir.external_min_charge, ir.notes
    FROM item_routes ir LEFT JOIN machines m ON m.id = ir.machine_id LEFT JOIN suppliers s ON s.id = ir.supplier_id
    WHERE ir.item_id = ? ORDER BY ir.sequence`, [itemId]);
  const company = await db.get('SELECT labor_rate, calc_material_surcharge, calc_overhead, calc_margin FROM companies WHERE id = nova_company_id()');
  return {
    item,
    materials,
    steps: steps.map((s) => ({
      sequence: s.sequence, step_type: s.step_type, machine_id: s.machine_id, machine_name: s.machine_name,
      hourly_rate: Number(s.hourly_rate), setup_min: Number(s.setup_time_min) || 0, minutes_per_piece: Number(s.process_time_min) || 0,
      supplier_id: s.supplier_id, supplier_name: s.supplier_name, price_per_piece: Number(s.external_price) || 0,
      min_charge: Number(s.external_min_charge) || 0, notes: s.notes,
    })),
    rates: {
      labor_rate: Number(company?.labor_rate) || 0,
      material_surcharge: Number(company?.calc_material_surcharge ?? 10),
      overhead: Number(company?.calc_overhead ?? 15),
      margin: Number(company?.calc_margin ?? 15),
    },
  };
}

/** Pure calculation for one quantity from (possibly edited) inputs. */
function priceFor(input, qty, extraPerBatch = 0) {
  const { materials, steps, rates } = input;
  const material = materials.reduce((s, m) => s + Number(m.qty_per_piece) * qty * Number(m.unit_cost), 0);
  const materialSurcharge = material * (Number(rates.material_surcharge) || 0) / 100;
  let machine = 0; let labour = 0; let external = 0; let hours = 0;
  const stepRows = steps.map((s) => {
    if (s.step_type === 'external') {
      const cost = Math.max(qty * Number(s.price_per_piece), Number(s.min_charge) || 0);
      external += cost;
      return { sequence: s.sequence, step_type: 'external', supplier_name: s.supplier_name, cost: r2(cost) };
    }
    const h = (Number(s.setup_min) + qty * Number(s.minutes_per_piece)) / 60;
    const mc = h * Number(s.hourly_rate);
    const lc = h * Number(rates.labor_rate);
    hours += h; machine += mc; labour += lc;
    return { sequence: s.sequence, step_type: 'internal', machine_name: s.machine_name, hours: r2(h), machine_cost: r2(mc), labour_cost: r2(lc) };
  });
  const extra = Number(extraPerBatch) || 0; // e.g. programming, fixtures, packaging per batch
  const overhead = (machine + labour) * (Number(rates.overhead) || 0) / 100;
  const cost = material + materialSurcharge + machine + labour + external + overhead + extra;
  const margin = cost * (Number(rates.margin) || 0) / 100;
  const net = cost + margin;
  const perPiece = qty ? net / qty : 0;
  return {
    quantity: qty,
    material: r2(material), material_surcharge: r2(materialSurcharge), machine: r2(machine), labour: r2(labour),
    external: r2(external), extra: r2(extra), overhead: r2(overhead), cost: r2(cost), margin: r2(margin), net: r2(net),
    hours: r2(hours), cost_per_piece: r4(qty ? cost / qty : 0), price_per_piece: r2(perPiece), steps: stepRows,
  };
}

function calculate(input, quantities, extraPerBatch) {
  return [...new Set(quantities.map(Number).filter((q) => q > 0))].sort((a, b) => a - b).map((q) => priceFor(input, q, extraPerBatch));
}

module.exports = { inputsFor, calculate, priceFor };
