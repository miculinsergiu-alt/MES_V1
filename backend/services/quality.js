/**
 * Quality helpers: tolerance check, quality hold of a production order and
 * quarantine of its production lot.
 */
const db = require('../db');

/** ok / nok for one value against a characteristic. */
function judge(ch, value, attributeOk) {
  if (ch.kind === 'attribute') return attributeOk ? 'ok' : 'nok';
  const v = Number(value);
  if (!Number.isFinite(v)) return 'nok';
  return v >= Number(ch.lower_limit) - 1e-9 && v <= Number(ch.upper_limit) + 1e-9 ? 'ok' : 'nok';
}

/**
 * Puts the production lot of a held order into quarantine (once), so it is
 * not used or delivered until quality decides.
 */
async function quarantineHeldLot(rootId, userId, reason = 'Messwert außer Toleranz / out of tolerance') {
  const root = await db.get('SELECT id, quality_hold FROM orders WHERE id = ?', [rootId]);
  if (!root?.quality_hold) return false;
  const lot = await db.get('SELECT id, item_id, lot_number, quantity FROM inventory_lots WHERE lot_number = ?', [`FA-${rootId}`]);
  if (!lot || Number(lot.quantity) <= 0) return false;
  const open = await db.get("SELECT id FROM quarantine_logs WHERE lot_number = ? AND status = 'pending'", [lot.lot_number]);
  if (open) {
    await db.run('UPDATE quarantine_logs SET quantity = ? WHERE id = ?', [lot.quantity, open.id]);
    return true;
  }
  await db.run(
    'INSERT INTO quarantine_logs (item_id, lot_number, quantity, reason, reported_by) VALUES (?, ?, ?, ?, ?)',
    [lot.item_id, lot.lot_number, lot.quantity, reason, userId],
  );
  return true;
}

module.exports = { judge, quarantineHeldLot };
