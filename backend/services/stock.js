/**
 * Stock movements with batches (lots).
 *
 * All bookings go through here so that stock levels, lots, movement
 * history, unit costs and the negative-stock rule stay consistent:
 *  - bookIn:  goods received or produced, into a lot
 *  - consume: material or goods leaving stock, taken from lots
 *             first-in-first-out (quarantined lots are skipped)
 */
const db = require('../db');
const { AppError } = require('../lib/errors');

/** Cost used for valuation: moving average if known, else the item's purchase / production cost. */
async function unitCostOf(itemId) {
  const i = await db.get('SELECT avg_cost, acquisition_cost, production_cost, type FROM items WHERE id = ?', [itemId]);
  if (!i) return 0;
  if (Number(i.avg_cost) > 0) return Number(i.avg_cost);
  return Number(i.type === 'raw_material' ? i.acquisition_cost : (i.production_cost || i.acquisition_cost)) || 0;
}

async function negativePolicy() {
  return (await db.get('SELECT negative_stock FROM companies WHERE id = nova_company_id()'))?.negative_stock || 'warn';
}

/**
 * Books goods into stock.
 * { itemId, qty, lotNumber?, sourceType, productionOrderId?, expirationDate?, unitCost?, referenceType, referenceId, userId }
 * Returns { lotId }.
 */
async function bookIn(p) {
  if (!(p.qty > 0)) return { lotId: null };
  let lotId = null;
  if (p.lotNumber) {
    const lot = await db.get(`
      INSERT INTO inventory_lots (item_id, lot_number, quantity, expiration_date, source_type, production_order_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (company_id, lot_number) DO UPDATE SET quantity = inventory_lots.quantity + EXCLUDED.quantity
      RETURNING id, item_id`,
    [p.itemId, p.lotNumber, p.qty, p.expirationDate ?? null, p.sourceType || 'receipt', p.productionOrderId ?? null]);
    if (lot.item_id !== p.itemId) throw new AppError(400, 'LOT_ITEM_MISMATCH', `Lot ${p.lotNumber} belongs to a different item`);
    lotId = lot.id;
  }
  await db.run(`
    INSERT INTO stock_levels (item_id, quantity, last_updated) VALUES (?, ?, nova_now())
    ON CONFLICT (item_id) DO UPDATE SET quantity = stock_levels.quantity + EXCLUDED.quantity, last_updated = nova_now()`,
  [p.itemId, p.qty]);
  await db.run(`
    INSERT INTO stock_transactions (item_id, lot_id, quantity, type, reference_type, reference_id, user_id, unit_cost)
    VALUES (?, ?, ?, 'in', ?, ?, ?, ?)`,
  [p.itemId, lotId, p.qty, p.referenceType, p.referenceId ?? null, p.userId ?? null, p.unitCost ?? await unitCostOf(p.itemId)]);
  return { lotId };
}

/** Lots with stock, oldest first, without lots blocked in quarantine. */
async function availableLots(itemId) {
  return db.all(`
    SELECT il.id, il.lot_number, il.quantity
    FROM inventory_lots il
    WHERE il.item_id = ? AND il.quantity > 0
      AND NOT EXISTS (SELECT 1 FROM quarantine_logs q WHERE q.lot_number = il.lot_number AND q.status = 'pending')
    ORDER BY il.created_at, il.id
    FOR UPDATE`, [itemId]);
}

/**
 * Takes goods out of stock, first-in-first-out over lots.
 * { itemId, qty, referenceType, referenceId, userId, orderId? (records material lots used), preferLotNumber? }
 * Returns { lots: [{ lotId, lotNumber, qty }], unlotted, negative, warning } .
 * warning is set when the company's rule is "warn" and stock goes negative:
 * { item_id, item_code, name, uom, available, required }, for the caller to show.
 */
async function consume(p) {
  const out = { lots: [], unlotted: 0, negative: false, warning: null };
  if (!(p.qty > 0)) return out;

  const level = await db.get('SELECT quantity FROM stock_levels WHERE item_id = ? FOR UPDATE', [p.itemId]);
  const onHand = Number(level?.quantity ?? 0);
  if (onHand < p.qty) {
    const policy = await negativePolicy();
    const item = policy === 'allow' ? null : await db.get('SELECT item_code, name, uom FROM items WHERE id = ?', [p.itemId]);
    if (policy === 'block') {
      throw new AppError(400, 'INSUFFICIENT_STOCK',
        `Not enough stock of ${item?.item_code} ${item?.name}: ${onHand} ${item?.uom || ''} available, ${p.qty} needed`,
        { item_id: p.itemId, available: onHand, required: p.qty });
    }
    out.negative = true;
    if (policy === 'warn') {
      out.warning = { item_id: p.itemId, item_code: item?.item_code, name: item?.name, uom: item?.uom || '', available: onHand, required: p.qty };
    }
  }

  const unitCost = await unitCostOf(p.itemId);
  let rest = p.qty;
  let lots = await availableLots(p.itemId);
  if (p.preferLotNumber) {
    lots = [...lots.filter((l) => l.lot_number === p.preferLotNumber), ...lots.filter((l) => l.lot_number !== p.preferLotNumber)];
  }
  for (const lot of lots) {
    if (rest <= 0) break;
    const take = Math.min(rest, Number(lot.quantity));
    await db.run('UPDATE inventory_lots SET quantity = quantity - ? WHERE id = ?', [take, lot.id]);
    await db.run(`
      INSERT INTO stock_transactions (item_id, lot_id, quantity, type, reference_type, reference_id, user_id, unit_cost)
      VALUES (?, ?, ?, 'out', ?, ?, ?, ?)`, [p.itemId, lot.id, -take, p.referenceType, p.referenceId ?? null, p.userId ?? null, unitCost]);
    if (p.orderId) {
      await db.run('INSERT INTO order_material_lots (order_id, item_id, lot_id, quantity_used) VALUES (?, ?, ?, ?)',
        [p.orderId, p.itemId, lot.id, take]);
    }
    out.lots.push({ lotId: lot.id, lotNumber: lot.lot_number, qty: take });
    rest = Math.round((rest - take) * 1e6) / 1e6;
  }
  if (rest > 0) {
    // Stock without lot assignment (e.g. opening stock without lots, or going negative)
    await db.run(`
      INSERT INTO stock_transactions (item_id, quantity, type, reference_type, reference_id, user_id, unit_cost)
      VALUES (?, ?, 'out', ?, ?, ?, ?)`, [p.itemId, -rest, p.referenceType, p.referenceId ?? null, p.userId ?? null, unitCost]);
    out.unlotted = rest;
  }
  await db.run(`
    INSERT INTO stock_levels (item_id, quantity, last_updated) VALUES (?, ?, nova_now())
    ON CONFLICT (item_id) DO UPDATE SET quantity = stock_levels.quantity + EXCLUDED.quantity, last_updated = nova_now()`,
  [p.itemId, -p.qty]);
  return out;
}

/**
 * Moving average cost after receiving qty at price:
 * new avg = (old stock × old avg + qty × price) / (old stock + qty). Negative or zero
 * old stock counts as zero, so the new price takes over.
 */
async function updateAverageCost(itemId, qty, price) {
  if (!(qty > 0) || !(price >= 0)) return;
  const item = await db.get('SELECT avg_cost FROM items WHERE id = ? FOR UPDATE', [itemId]);
  const level = await db.get('SELECT quantity FROM stock_levels WHERE item_id = ?', [itemId]);
  const oldQty = Math.max(0, Number(level?.quantity ?? 0));
  const oldAvg = Number(item?.avg_cost) > 0 ? Number(item.avg_cost) : price;
  const avg = (oldQty * oldAvg + qty * price) / (oldQty + qty);
  await db.run('UPDATE items SET avg_cost = ? WHERE id = ?', [Math.round(avg * 10000) / 10000, itemId]);
}

module.exports = { bookIn, consume, unitCostOf, updateAverageCost, negativePolicy, availableLots };
