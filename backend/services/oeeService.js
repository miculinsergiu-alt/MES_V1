const { db } = require('../db/init');

class OEEService {
  /**
   * Calculate OEE for a specific machine in a given time range.
   * OEE = Availability * Performance * Quality
   */
  static calculateMachineOEE(machineId, dateFrom, dateTo) {
    // 1. Availability = Actual Run Time / Planned Production Time
    // Planned Production Time = Total planned working time in range
    const orders = db.prepare(`
      SELECT * FROM orders 
      WHERE machine_id = ? AND status != 'cancelled'
      AND planned_start >= ? AND planned_end <= ?
    `).all(machineId, dateFrom, dateTo);

    let totalPlannedMin = 0;
    let totalActualRunMin = 0;
    let totalQtyOk = 0;
    let totalQtyFail = 0;

    orders.forEach(order => {
      const start = new Date(order.planned_start);
      const end = new Date(order.planned_end);
      totalPlannedMin += (end - start) / 60000;

      // Get actual production results for this order
      const results = db.prepare('SELECT qty_ok, qty_fail FROM production_results WHERE order_id = ?').all(order.id);
      results.forEach(r => {
        totalQtyOk += r.qty_ok;
        totalQtyFail += r.qty_fail;
      });

      // Get actual run time from operator actions (working_start to working_end)
      const allocations = db.prepare('SELECT id FROM machine_allocations WHERE order_id = ?').all(order.id);
      allocations.forEach(alloc => {
        const actions = db.prepare(`
          SELECT action_type, timestamp FROM operator_actions 
          WHERE allocation_id = ? AND action_type IN ('working_start', 'working_end')
          ORDER BY timestamp ASC
        `).all(alloc.id);

        for (let i = 0; i < actions.length - 1; i += 2) {
          if (actions[i].action_type === 'working_start' && actions[i+1].action_type === 'working_end') {
            totalActualRunMin += (new Date(actions[i+1].timestamp) - new Date(actions[i].timestamp)) / 60000;
          }
        }
      });
    });

    const availability = totalPlannedMin > 0 ? Math.min(1, totalActualRunMin / totalPlannedMin) : 0;

    // 2. Performance = (Total Produced / Total Planned) * (Planned Time / Actual Time)
    // Simplified: (Total Produced * Ideal Cycle Time) / Actual Run Time
    // We'll use a constant ideal cycle time of 1 min per unit if not specified in items
    const totalProduced = totalQtyOk + totalQtyFail;
    const performance = (totalActualRunMin > 0 && totalProduced > 0) ? Math.min(1, (totalProduced * 1) / totalActualRunMin) : 0;

    // 3. Quality = Good Units / Total Units
    const quality = totalProduced > 0 ? totalQtyOk / totalProduced : 0;

    const oee = availability * performance * quality;

    return {
      machine_id: machineId,
      availability: Math.round(availability * 100),
      performance: Math.round(performance * 100),
      quality: Math.round(quality * 100),
      oee: Math.round(oee * 100),
      metrics: {
        totalPlannedMin,
        totalActualRunMin,
        totalQtyOk,
        totalQtyFail,
        totalProduced
      }
    };
  }

  static getGlobalOEE(dateFrom, dateTo) {
    const machines = db.prepare('SELECT id, name FROM machines WHERE active = 1').all();
    const machineStats = machines.map(m => this.calculateMachineOEE(m.id, dateFrom, dateTo));
    
    if (machineStats.length === 0) return { oee: 0 };

    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
      overall_oee: Math.round(avg(machineStats.map(s => s.oee))),
      overall_availability: Math.round(avg(machineStats.map(s => s.availability))),
      overall_performance: Math.round(avg(machineStats.map(s => s.performance))),
      overall_quality: Math.round(avg(machineStats.map(s => s.quality))),
      by_machine: machineStats
    };
  }
}

module.exports = OEEService;
