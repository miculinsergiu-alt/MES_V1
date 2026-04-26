const { db } = require('../db/init');
const { addMinutes } = require('./dateUtils');

/**
 * Unified schedule propagation logic.
 * Shifting an order's end time and subsequently shifting all future orders on the same machine.
 *
 * @param {number} machineId - ID of the machine
 * @param {number} fromOrderId - ID of the order where the delay originated
 * @param {number} delayMinutes - Number of minutes to shift
 */
function propagateSchedule(machineId, fromOrderId, delayMinutes) {
  try {
    // 1. Get the order where delay started
    const currentOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(fromOrderId);
    if (!currentOrder) {
        console.warn(`[Scheduler] Order ${fromOrderId} not found for propagation.`);
        return;
    }

    db.transaction(() => {
      // 2. Update current order end time
      const newCurrentEnd = addMinutes(currentOrder.planned_end, delayMinutes);
      db.prepare('UPDATE orders SET planned_end = ? WHERE id = ?').run(newCurrentEnd, fromOrderId);

      // 3. Shift all FUTURE orders on this machine
      // We look for orders that start AFTER or AT the same time as the current one's ORIGINAL start time
      const subsequentOrders = db.prepare(`
        SELECT * FROM orders
        WHERE machine_id = ? AND id != ? AND status IN ('pending','active')
        AND datetime(planned_start) >= datetime(?)
        ORDER BY planned_start ASC
      `).all(machineId, fromOrderId, currentOrder.planned_start);

      let lastEnd = newCurrentEnd;

      for (const order of subsequentOrders) {
        const durationMins = (new Date(order.planned_end) - new Date(order.planned_start)) / 60000;
        const newStart = lastEnd;
        const newEnd = addMinutes(newStart, durationMins);

        db.prepare('UPDATE orders SET planned_start = ?, planned_end = ? WHERE id = ?').run(newStart, newEnd, order.id);
        lastEnd = newEnd;
      }
    })();

    console.log(`[Scheduler] Successfully propagated ${delayMinutes} mins delay for Machine ${machineId} starting from Order ${fromOrderId}`);
  } catch (err) {
    console.error(`[Scheduler] Error during schedule propagation:`, {
        error: err.message,
        machineId,
        fromOrderId,
        delayMinutes
    });
    throw err; // Re-throw to allow transaction rollback if called within one
  }
}

module.exports = { propagateSchedule };
