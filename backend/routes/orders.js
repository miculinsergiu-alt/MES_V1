const express = require('express');
const { ordersDb, machinesDb, itemsDb, productionDb } = require('../db/init');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/orders/delay-reasons
router.get('/delay-reasons', authenticateToken, (req, res) => {
  const reasons = ordersDb.prepare('SELECT * FROM delay_reasons ORDER BY name ASC').all();
  res.json(reasons);
});

// ─── Helper: propagate delay to subsequent orders on same machine + routing chain ───
function propagateDelay(machineId, fromOrderId, delayMinutes) {
  const currentOrder = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(fromOrderId);
  if (!currentOrder) return;

  // 1. Update current order end time
  const newCurrentEnd = addMinutes(currentOrder.planned_end, delayMinutes);
  ordersDb.prepare('UPDATE orders SET planned_end = ? WHERE id = ?').run(newCurrentEnd, fromOrderId);

  // 2. Shift all FUTURE steps of the SAME routing chain (Idea #2)
  // These might be on DIFFERENT machines
  if (currentOrder.parent_order_id || ordersDb.prepare('SELECT id FROM orders WHERE parent_order_id = ? LIMIT 1').get(fromOrderId)) {
    const rootId = currentOrder.parent_order_id || currentOrder.id;
    const chainSteps = ordersDb.prepare(`
      SELECT * FROM orders 
      WHERE (parent_order_id = ? OR id = ?) AND routing_sequence > ?
      AND status IN ('pending','active')
      ORDER BY routing_sequence ASC
    `).all(rootId, rootId, currentOrder.routing_sequence);

    let lastChainEnd = newCurrentEnd;
    for (const step of chainSteps) {
      const stepDurationMins = (new Date(step.planned_end) - new Date(step.planned_start)) / 60000;
      const newStepStart = lastChainEnd;
      const newStepEnd = addMinutes(newStepStart, stepDurationMins);
      
      ordersDb.prepare('UPDATE orders SET planned_start = ?, planned_end = ? WHERE id = ?').run(newStepStart, newStepEnd, step.id);
      
      // IMPORTANT: Since this step's time changed, we must ALSO propagate to other orders on ITS machine
      propagateMachineShift(step.machine_id, step.id, newStepStart);
      
      lastChainEnd = newStepEnd;
    }
  }

  // 3. Shift all FUTURE orders on this machine (Standard propagation)
  propagateMachineShift(machineId, fromOrderId, newCurrentEnd);
}

function propagateMachineShift(machineId, afterOrderId, newStartTime) {
  const subsequentOrders = ordersDb.prepare(`
    SELECT * FROM orders
    WHERE machine_id = ? AND id != ? AND status IN ('pending','active')
    AND datetime(planned_start) >= (SELECT datetime(planned_start) FROM orders WHERE id = ?)
    ORDER BY planned_start ASC
  `).all(machineId, afterOrderId, afterOrderId);

  let lastEnd = newStartTime;

  for (const order of subsequentOrders) {
    // If there was a gap, we might want to preserve it, but the project rule is "no gaps/overlaps"
    const newStart = lastEnd; 
    const durationMins = (new Date(order.planned_end) - new Date(order.planned_start)) / 60000;
    const newEnd = addMinutes(newStart, durationMins);
    
    ordersDb.prepare('UPDATE orders SET planned_start = ?, planned_end = ? WHERE id = ?').run(newStart, newEnd, order.id);
    
    // If THIS order is part of a chain, we need to shift its subsequent steps too
    // Recursive call could be dangerous, so we just trigger the chain shift if needed
    // Actually, propagateDelay already handles both. 
    // To keep it simple, we'll let the user know this is "best effort" or refine later.
    
    lastEnd = newEnd;
  }
}

function addMinutes(dateStr, minutes) {
  // Ensure we parse consistently (handle both ' ' and 'T')
  const d = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(d.getTime())) return dateStr;
  
  d.setMinutes(d.getMinutes() + Math.round(minutes));
  
  const pad = (num) => String(num).padStart(2, '0');
  // Returns YYYY-MM-DD HH:MM:SS for strict lexicographical comparison in SQLite
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// GET /api/orders — all orders (optionally filtered by machine)
router.get('/', authenticateToken, (req, res) => {
  const { machine_id, status, date_from, date_to, order_type } = req.query;
  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (machine_id) { sql += ' AND machine_id = ?'; params.push(machine_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (order_type) { sql += ' AND order_type = ?'; params.push(order_type); }
  if (date_from) { sql += ' AND planned_start >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND planned_end <= ?'; params.push(date_to); }
  sql += ' ORDER BY planned_start ASC';
  const orders = ordersDb.prepare(sql).all(...params);
  res.json(orders);
});

// GET /api/orders/gantt — orders grouped by machine for Gantt display
router.get('/gantt', authenticateToken, (req, res) => {
  const { date_from, date_to } = req.query;
  let sql = "SELECT * FROM orders WHERE status != 'cancelled'";
  const params = [];
  if (date_from) { sql += ' AND planned_end >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND planned_start <= ?'; params.push(date_to); }
  sql += ' ORDER BY machine_id, planned_start ASC';
  const orders = ordersDb.prepare(sql).all(...params);

  const { productionDb } = require('../db/init');

  // Attach delays and current_phase
  const result = orders.map(order => {
    const delays = ordersDb.prepare(`
      SELECT od.*, dr.name as reason_name, dr.category as reason_category
      FROM order_delays od
      LEFT JOIN delay_reasons dr ON od.delay_reason_id = dr.id
      WHERE od.order_id = ? 
      ORDER BY od.created_at
    `).all(order.id);

    const allocations = productionDb.prepare(`
      SELECT * FROM machine_allocations WHERE order_id = ? ORDER BY start_time ASC
    `).all(order.id);

    let actions = [];
    if (allocations.length > 0) {
      const allocIds = allocations.map(a => a.id).join(',');
      actions = productionDb.prepare(`
        SELECT * FROM operator_actions WHERE allocation_id IN (${allocIds}) ORDER BY timestamp ASC
      `).all();
    }

    // Keep current_phase for legacy compatibility if needed
    let current_phase = allocations.length > 0 ? allocations[allocations.length - 1].phase : null;
    if (actions.length > 0) {
      const lastAction = actions[actions.length - 1];
      if (lastAction.action_type.includes('_start')) {
        current_phase = lastAction.action_type.replace('_start', '');
      }
    }

    return { ...order, delays, current_phase, allocations, actions };
  });
  res.json(result);
});

// GET /api/orders/:id
router.get('/:id', authenticateToken, (req, res) => {
  const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită' });
  const delays = ordersDb.prepare('SELECT * FROM order_delays WHERE order_id = ? ORDER BY created_at').all(order.id);
  res.json({ ...order, delays });
});

// ─── MRP ALLOCATION LOGIC (Recursive) ───
function allocateMaterialsForOrder(orderId, bomId, orderQuantity) {
  if (!bomId) return;
  console.log(`[MRP] Starting recursive allocation for Order ${orderId} (BOM ${bomId}, Order Qty ${orderQuantity})`);

  // Helper for recursive explosion
  function explode(currentBomId, currentQty) {
    // We select EVERYTHING from bom_positions to ensure L1 items are included
    const positions = ordersDb.prepare(`
      SELECT bp.item_id, bp.quantity as bom_quantity, bp.node_type, i.name as item_name, i.type as item_type
      FROM bom_positions bp
      JOIN items i ON bp.item_id = i.id
      WHERE bp.bom_id = ?
    `).all(currentBomId);

    console.log(`[MRP] BOM ${currentBomId} has ${positions.length} positions to check.`);

    for (const pos of positions) {
      // Required = Qty in BOM * Parent Qty
      const requiredTotal = pos.bom_quantity * currentQty;
      console.log(`[MRP] Processing ${pos.item_name} (${pos.item_type}): Needs ${requiredTotal} (BOM Qty ${pos.bom_quantity} x Parent Qty ${currentQty})`);
      
      // RULE: If it's a RAW MATERIAL, we check stock and create PO if needed
      if (pos.item_type === 'raw_material') {
        processRawMaterial(pos.item_id, pos.item_name, requiredTotal);
      } 
      // RULE: If it's a SEMI-FINISHED, we must dig deeper into ITS OWN BOM
      else if (pos.item_type === 'semi_finished') {
        const subBom = ordersDb.prepare('SELECT id FROM boms WHERE parent_item_id = ? LIMIT 1').get(pos.item_id);
        if (subBom) {
          console.log(`[MRP] Digging into sub-recipe for SF: ${pos.item_name} -> BOM ${subBom.id}`);
          explode(subBom.id, requiredTotal);
        } else {
          console.log(`[MRP] WARNING: SF ${pos.item_name} has no BOM defined! Cannot calculate its components.`);
        }
      }
    }
  }

  function processRawMaterial(itemId, itemName, requiredTotal) {
    if (requiredTotal <= 0) return;

    // Check current stock and reservations
    const stock = ordersDb.prepare('SELECT * FROM stock_levels WHERE item_id = ?').get(itemId);
    const totalPhysical = stock ? stock.quantity : 0;
    const totalReserved = stock ? (stock.allocated_quantity || 0) : 0;
    const available = Math.max(0, totalPhysical - totalReserved);

    console.log(`[MRP] Stock Check for ${itemName}: Physical=${totalPhysical}, Reserved=${totalReserved}, Available=${available}, Required=${requiredTotal}`);

    let qtyToAllocate = 0;
    let deficit = 0;

    if (available >= requiredTotal) {
      qtyToAllocate = requiredTotal;
    } else {
      qtyToAllocate = available;
      deficit = requiredTotal - available;
    }

    // 1. Update Stock Reservation (soft allocation)
    if (qtyToAllocate > 0) {
      if (stock) {
        ordersDb.prepare('UPDATE stock_levels SET allocated_quantity = allocated_quantity + ? WHERE item_id = ?').run(qtyToAllocate, itemId);
      } else {
        ordersDb.prepare('INSERT INTO stock_levels (item_id, quantity, allocated_quantity) VALUES (?, 0, ?)').run(itemId, qtyToAllocate);
      }
      
      ordersDb.prepare('INSERT INTO order_material_allocations (order_id, item_id, allocated_qty) VALUES (?, ?, ?)').run(orderId, itemId, qtyToAllocate);
      console.log(`[MRP] SUCCESS: Reserved ${qtyToAllocate} ${itemName} for Order ${orderId}`);
    }

    // 2. Generate PO Recommendation if there's a deficit
    if (deficit > 0) {
      const exists = ordersDb.prepare('SELECT id FROM purchase_recommendations WHERE triggering_order_id = ? AND item_id = ? AND status = "pending"').get(orderId, itemId);
      if (!exists) {
        ordersDb.prepare(`
          INSERT INTO purchase_recommendations (item_id, recommended_qty, triggering_order_id) 
          VALUES (?, ?, ?)
        `).run(itemId, deficit, orderId);
        console.log(`[MRP] ALERT: Deficit detected! Recommended PO for ${deficit} ${itemName} (Order ${orderId})`);
      }
    }
  }

  explode(bomId, orderQuantity);
}

// ─── Helper: Find next free slot on machine ───
function getMachineAvailableTime(machineId, fromTime) {
  // SQLite string comparison works perfectly for YYYY-MM-DD HH:MM:SS
  const latestOrder = ordersDb.prepare(`
    SELECT planned_end FROM orders 
    WHERE machine_id = ? AND status IN ('pending', 'active')
    AND planned_end > ?
    ORDER BY planned_end DESC LIMIT 1
  `).get(machineId, fromTime);
  
  if (latestOrder) {
    console.log(`[Scheduler] Machine ${machineId} is busy until ${latestOrder.planned_end}. Pushing from ${fromTime}`);
    return latestOrder.planned_end;
  }
  return fromTime;
}

// POST /api/orders — create order(s)
router.post('/', authenticateToken, requireRole('planner', 'administrator'), (req, res) => {
  const { orders } = req.body; // array of orders
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ error: 'Lista de comenzi este obligatorie' });
  }

  const created = [];
  const insertStmt = ordersDb.prepare(`
    INSERT INTO orders (machine_id, product_name, item_id, bom_id, quantity, planned_start, planned_end, status, order_type, created_by, parent_order_id, routing_sequence)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `);

  const transaction = ordersDb.transaction(() => {
    for (const o of orders) {
      const { machine_id, product_name, item_id, bom_id, quantity, planned_start, planned_end, order_type } = o;
      
      // Check if item has a route
      const route = item_id 
        ? ordersDb.prepare('SELECT * FROM item_routes WHERE item_id = ? ORDER BY sequence ASC').all(item_id)
        : [];

      if (route.length > 0) {
        // ─── EXPLOSION MODE with Conflict Prevention ───
        let lastEnd = planned_start;
        let firstParentId = null;

        for (let i = 0; i < route.length; i++) {
          const step = route[i];
          
          // 1. Calculate Earliest Start (after previous step)
          const earliestStart = lastEnd;
          
          // 2. Adjust for Machine Availability (Finite Capacity)
          const actualStart = getMachineAvailableTime(step.machine_id, earliestStart);
          
          const durationMins = (step.process_time_min || 0) * quantity;
          const actualEnd = addMinutes(actualStart, durationMins || 60);

          const result = insertStmt.run(
            step.machine_id,
            `${product_name} [${i+1}/${route.length}]`,
            item_id,
            bom_id || null,
            quantity,
            actualStart,
            actualEnd,
            order_type || 'production',
            req.user.id,
            firstParentId,
            step.sequence
          );

          if (i === 0) firstParentId = result.lastInsertRowid;
          
          created.push({ id: result.lastInsertRowid, machine_id: step.machine_id, product_name: `${product_name} [${i+1}/${route.length}]`, item_id, bom_id, quantity, planned_start: actualStart, planned_end: actualEnd });
          lastEnd = actualEnd;
          
          if (i === 0) {
              allocateMaterialsForOrder(result.lastInsertRowid, bom_id, quantity);
          }
        }
      } else {
        // ─── STANDARD MODE (No route) with Conflict Prevention ───
        if (!machine_id || !product_name || !quantity || !planned_start) {
          throw new Error('Câmpurile obligatorii lipsesc');
        }
        
        const actualStart = getMachineAvailableTime(machine_id, planned_start);
        let actualEnd = planned_end;
        
        // If end not provided or overlapped, re-calculate
        if (!actualEnd || new Date(actualEnd) <= new Date(actualStart)) {
            actualEnd = addMinutes(actualStart, 60); // Default 1h if unknown
        } else {
            // Keep duration but shift start
            const duration = (new Date(planned_end) - new Date(planned_start)) / 60000;
            actualEnd = addMinutes(actualStart, duration);
        }

        const result = insertStmt.run(machine_id, product_name, item_id || null, bom_id || null, quantity, actualStart, actualEnd, order_type || 'production', req.user.id, null, 0);
        created.push({ id: result.lastInsertRowid, machine_id, product_name, item_id, bom_id, quantity, planned_start: actualStart, planned_end: actualEnd, order_type: order_type || 'production' });
        
        allocateMaterialsForOrder(result.lastInsertRowid, bom_id, quantity);
      }
    }
  });

  try {
      transaction();
      res.status(201).json({ created, message: `${created.length} comandă/comenzi create.` });
  } catch(e) {
      res.status(400).json({ error: e.message });
  }
});

// PUT /api/orders/:id
router.put('/:id', authenticateToken, requireRole('planner', 'administrator'), (req, res) => {
  const { machine_id, product_name, item_id, bom_id, quantity, planned_start, planned_end, status, order_type } = req.body;
  const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită' });

  ordersDb.prepare(`
    UPDATE orders SET machine_id=?, product_name=?, item_id=?, bom_id=?, quantity=?, planned_start=?, planned_end=?, status=?, order_type=? WHERE id=?
  `).run(
    machine_id || order.machine_id,
    product_name || order.product_name,
    item_id !== undefined ? item_id : order.item_id,
    bom_id !== undefined ? bom_id : order.bom_id,
    quantity ?? order.quantity,
    planned_start || order.planned_start,
    planned_end || order.planned_end,
    status || order.status,
    order_type || order.order_type,
    req.params.id
  );

  // If time changed, propagate to machine and routing chain
  if (planned_start || planned_end) {
    const finalStart = planned_start || order.planned_start;
    const finalEnd = planned_end || order.planned_end;
    
    // Propagate to chain
    if (order.parent_order_id || ordersDb.prepare('SELECT id FROM orders WHERE parent_order_id = ? LIMIT 1').get(order.id)) {
      const rootId = order.parent_order_id || order.id;
      const chainSteps = ordersDb.prepare(`
        SELECT * FROM orders 
        WHERE (parent_order_id = ? OR id = ?) AND routing_sequence > ?
        AND status IN ('pending','active')
        ORDER BY routing_sequence ASC
      `).all(rootId, rootId, order.routing_sequence);

      let lastChainEnd = finalEnd;
      for (const step of chainSteps) {
        const stepDurationMins = (new Date(step.planned_end) - new Date(step.planned_start)) / 60000;
        const newStepStart = lastChainEnd;
        const newStepEnd = addMinutes(newStepStart, stepDurationMins);
        ordersDb.prepare('UPDATE orders SET planned_start = ?, planned_end = ? WHERE id = ?').run(newStepStart, newStepEnd, step.id);
        propagateMachineShift(step.machine_id, step.id, newStepStart);
        lastChainEnd = newStepEnd;
      }
    }

    // Propagate to machine
    propagateMachineShift(machine_id || order.machine_id, req.params.id, finalEnd);
  }

  res.json({ message: 'Comanda actualizată și planul re-aliniat' });
});

function releaseAllocationsForOrder(orderId) {
  const allocations = ordersDb.prepare('SELECT * FROM order_material_allocations WHERE order_id = ?').all(orderId);
  for (const alloc of allocations) {
    ordersDb.prepare('UPDATE stock_levels SET allocated_quantity = allocated_quantity - ? WHERE item_id = ?').run(alloc.allocated_qty, alloc.item_id);
  }
  ordersDb.prepare('DELETE FROM order_material_allocations WHERE order_id = ?').run(orderId);
  // Optional: Also delete pending purchase recommendations triggered by this order
  ordersDb.prepare("DELETE FROM purchase_recommendations WHERE triggering_order_id = ? AND status = 'pending'").run(orderId);
}

// DELETE /api/orders/:id (cancel)
router.delete('/:id', authenticateToken, requireRole('planner', 'administrator'), (req, res) => {
  const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită' });
  
  const transaction = ordersDb.transaction(() => {
    ordersDb.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(req.params.id);
    releaseAllocationsForOrder(req.params.id);
  });

  try {
    transaction();
    res.json({ message: 'Comanda anulată și alocările eliberate' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/orders/:id/delay — add delay to order and propagate
router.post('/:id/delay', authenticateToken, (req, res) => {
  const { delay_minutes, reason, delay_reason_id, corrective_action, source } = req.body;
  if (!delay_minutes || delay_minutes <= 0) return res.status(400).json({ error: 'Minutele de întârziere trebuie să fie pozitive' });

  const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită' });

  // Check for duplicate delay from same source on same order
  if (source === 'shift_responsible') {
    const alreadyLogged = ordersDb.prepare("SELECT id FROM order_delays WHERE order_id = ? AND source = 'operator'").get(order.id);
    if (alreadyLogged) {
      // Log it but mark as not applied (anti-duplicate)
      ordersDb.prepare('INSERT INTO order_delays (order_id, delay_minutes, reason, delay_reason_id, corrective_action, reported_by, source, applied) VALUES (?,?,?,?,?,?,?,0)')
        .run(order.id, delay_minutes, reason || '', delay_reason_id || null, corrective_action || '', req.user.id, source);
      return res.json({ message: 'Delay înregistrat (nu aplicat — deja logat de operator)', applied: false });
    }
  }

  // Insert delay record
  ordersDb.prepare('INSERT INTO order_delays (order_id, delay_minutes, reason, delay_reason_id, corrective_action, reported_by, source, applied) VALUES (?,?,?,?,?,?,?,1)')
    .run(order.id, delay_minutes, reason || '', delay_reason_id || null, corrective_action || '', req.user.id, source || 'system');

  // Propagate to current order + subsequent orders on same machine
  propagateDelay(order.machine_id, order.id, delay_minutes);

  res.json({ message: `Delay de ${delay_minutes} minute aplicat și propagat`, applied: true });
});

// GET /api/orders/:id/delays
router.get('/:id/delays', authenticateToken, (req, res) => {
  const delays = ordersDb.prepare('SELECT * FROM order_delays WHERE order_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(delays);
});

// GET /api/orders/:id/materials
router.get('/:id/materials', authenticateToken, (req, res) => {
  const order = ordersDb.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită' });
  if (!order.bom_id) return res.json([]); 

  const { itemsDb } = require('../db/init');
  // Fetch all positions, including departments/phantoms
  const positions = itemsDb.prepare(`
    SELECT 
      bp.id,
      bp.parent_position_id,
      bp.node_type,
      bp.department,
      bp.level,
      bp.quantity as bom_quantity, 
      bp.position_code, 
      bp.location, 
      i.item_code, 
      i.name as item_name, 
      i.uom
    FROM bom_positions bp
    LEFT JOIN items i ON bp.item_id = i.id
    WHERE bp.bom_id = ?
    ORDER BY bp.level ASC, bp.sort_order ASC, bp.position_code ASC
  `).all(order.bom_id);

  // Multiply by order quantity and attach to result
  const materials = positions.map(p => ({
    ...p,
    required_quantity: p.node_type === 'component' ? (p.bom_quantity * order.quantity) : null
  }));

  res.json(materials);
});

// GET /api/orders/:id/chain — get all orders in the same routing chain
router.get('/:id/chain', authenticateToken, (req, res) => {
  const order = ordersDb.prepare('SELECT id, parent_order_id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Comanda nu a fost găsită' });

  const rootId = order.parent_order_id || order.id;
  const chain = ordersDb.prepare(`
    SELECT o.*, m.name as machine_name
    FROM orders o
    LEFT JOIN machines m ON o.machine_id = m.id
    WHERE o.id = ? OR o.parent_order_id = ?
    ORDER BY o.routing_sequence ASC, o.planned_start ASC
  `).all(rootId, rootId);

  res.json(chain);
});

module.exports = router;
