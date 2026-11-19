/**
 * Tool management: tools with life in parts, mounted on machines, usage
 * counted from production results, spares, replacement / regrind log.
 */
const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest, conflict } = require('../lib/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);
const EDITORS = ['administrator', 'planner', 'area_supervisor', 'shift_responsible', 'warehouse_manager'];
const WARN_AT = 0.9;

const SELECT = `SELECT t.*, m.name AS machine_name, s.name AS supplier_name FROM tools t
  LEFT JOIN machines m ON m.id = t.machine_id LEFT JOIN suppliers s ON s.id = t.supplier_id`;

function withWear(t) {
  const wear = t.life_limit_parts ? t.used_parts / t.life_limit_parts : null;
  return { ...t, wear_percent: wear === null ? null : Math.round(wear * 100), worn: wear !== null && wear >= WARN_AT, expired: wear !== null && wear >= 1,
    spares_low: t.min_spares > 0 && t.spare_count < t.min_spares };
}

/** Called after production results: count the parts on the tools mounted on that machine. */
async function countUsage(machineId, parts) {
  if (!machineId || !(parts > 0)) return;
  await db.run('UPDATE tools SET used_parts = used_parts + ? WHERE machine_id = ? AND active = 1', [Math.round(parts), machineId]);
}

// GET /api/tools?machine_id=&attention=1 — everyone (operators see wear at their machine)
router.get('/', h(async (req, res) => {
  const q = v.query(req, v.z.object({ machine_id: v.optId, attention: v.flag.optional(), all: v.flag.optional() }));
  const rows = (await db.all(`${SELECT} WHERE (?::int IS NULL OR t.machine_id = ?) AND (? OR t.active = 1) ORDER BY t.code`,
    [q.machine_id ?? null, q.machine_id ?? null, !!q.all])).map(withWear);
  res.json(q.attention ? rows.filter((t) => t.worn || t.spares_low) : rows);
}));

const schema = v.z.object({
  code: v.z.string().trim().min(1).max(50), name: v.z.string().trim().min(1).max(200), tool_type: v.optStr(100),
  machine_id: v.optId, life_limit_parts: v.z.preprocess((x) => (x === '' || x === null ? undefined : x), v.z.coerce.number().int().positive().optional()),
  spare_count: v.z.coerce.number().int().min(0).optional(), min_spares: v.z.coerce.number().int().min(0).optional(),
  supplier_id: v.optId, unit_cost: v.z.preprocess((x) => (x === '' || x === null ? undefined : x), v.z.coerce.number().min(0).optional()),
  notes: v.optStr(2000), active: v.flag.optional(),
});

router.post('/', requireRole(...EDITORS), h(async (req, res) => {
  const b = v.body(req, schema);
  if (await db.get('SELECT id FROM tools WHERE code = ?', [b.code])) throw conflict('A tool with this code exists');
  const row = await db.get(`INSERT INTO tools (code, name, tool_type, machine_id, life_limit_parts, spare_count, min_spares, supplier_id, unit_cost, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`, [b.code, b.name, b.tool_type ?? null, b.machine_id ?? null, b.life_limit_parts ?? null,
    b.spare_count ?? 0, b.min_spares ?? 0, b.supplier_id ?? null, b.unit_cost ?? null, b.notes ?? null]);
  if (b.machine_id) await db.run("INSERT INTO tool_events (tool_id, kind, machine_id, user_id) VALUES (?, 'mounted', ?, ?)", [row.id, b.machine_id, req.user.id]);
  res.status(201).json(withWear(await db.get(`${SELECT} WHERE t.id = ?`, [row.id])));
}));

router.put('/:id', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const cur = await db.get('SELECT * FROM tools WHERE id = ?', [id]);
  if (!cur) throw notFound('Tool');
  const b = v.body(req, schema.partial());
  const n = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, x]) => x !== undefined)) };
  if ('machine_id' in req.body && (req.body.machine_id === null || req.body.machine_id === '')) n.machine_id = null;
  await db.run(`UPDATE tools SET code=?, name=?, tool_type=?, machine_id=?, life_limit_parts=?, spare_count=?, min_spares=?, supplier_id=?, unit_cost=?, notes=?, active=? WHERE id=?`,
    [n.code, n.name, n.tool_type, n.machine_id, n.life_limit_parts, n.spare_count, n.min_spares, n.supplier_id, n.unit_cost, n.notes, n.active, id]);
  if ((n.machine_id ?? null) !== (cur.machine_id ?? null)) {
    await db.run('INSERT INTO tool_events (tool_id, kind, machine_id, user_id) VALUES (?, ?, ?, ?)', [id, n.machine_id ? 'mounted' : 'unmounted', n.machine_id ?? cur.machine_id, req.user.id]);
  }
  res.json(withWear(await db.get(`${SELECT} WHERE t.id = ?`, [id])));
}));

// POST /api/tools/:id/replace { kind: 'replaced' | 'regrind', note? } — counter back to 0; a replacement uses one spare
router.post('/:id/replace', requireRole(...EDITORS, 'operator'), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, v.z.object({ kind: v.z.enum(['replaced', 'regrind']).default('replaced'), note: v.optStr(1000) }));
  const t = await db.get('SELECT * FROM tools WHERE id = ? FOR UPDATE', [id]);
  if (!t) throw notFound('Tool');
  if (b.kind === 'replaced' && t.spare_count <= 0) throw badRequest('No spare tool in stock');
  await db.run('INSERT INTO tool_events (tool_id, kind, used_parts_before, machine_id, note, user_id) VALUES (?,?,?,?,?,?)', [id, b.kind, t.used_parts, t.machine_id, b.note ?? null, req.user.id]);
  await db.run(`UPDATE tools SET used_parts = 0, spare_count = spare_count - ? WHERE id = ?`, [b.kind === 'replaced' ? 1 : 0, id]);
  res.json(withWear(await db.get(`${SELECT} WHERE t.id = ?`, [id])));
}));

// POST /api/tools/:id/spares { quantity } — spares received
router.post('/:id/spares', requireRole(...EDITORS), h(async (req, res) => {
  const id = v.paramId(req);
  const { quantity, note } = v.body(req, v.z.object({ quantity: v.z.coerce.number().int().positive().max(100000), note: v.optStr(1000) }));
  const t = await db.get('SELECT id FROM tools WHERE id = ?', [id]);
  if (!t) throw notFound('Tool');
  await db.run('UPDATE tools SET spare_count = spare_count + ? WHERE id = ?', [quantity, id]);
  await db.run("INSERT INTO tool_events (tool_id, kind, quantity, note, user_id) VALUES (?, 'spares_added', ?, ?, ?)", [id, quantity, note ?? null, req.user.id]);
  res.json(withWear(await db.get(`${SELECT} WHERE t.id = ?`, [id])));
}));

router.get('/:id/events', h(async (req, res) => {
  res.json(await db.all(`SELECT e.*, u.first_name || ' ' || u.last_name AS user_name, m.name AS machine_name
    FROM tool_events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN machines m ON m.id = e.machine_id
    WHERE e.tool_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT 200`, [v.paramId(req)]));
}));

module.exports = router;
module.exports.countUsage = countUsage;
