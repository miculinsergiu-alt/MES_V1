const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { authenticateToken, requireRole, ROLES, blockInDemo } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken, blockInDemo);

const PUBLIC_FIELDS = 'id, first_name, last_name, badge_number, email, role, roles, active, created_at';
const password = v.z.string().min(8, 'Password must be at least 8 characters').max(200);

// GET /api/users — list all users (admin, supervisor)
router.get('/', requireRole('administrator', 'area_supervisor'), h(async (req, res) => {
  res.json(await db.all(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY id DESC`));
}));

// GET /api/users/operators — active operators (for shift assignment)
router.get('/operators', h(async (req, res) => {
  res.json(await db.all("SELECT id, first_name, last_name, badge_number FROM users WHERE 'operator' = ANY(roles) AND active = 1 ORDER BY last_name"));
}));

// GET /api/users/by-role/:role
router.get('/by-role/:role', h(async (req, res) => {
  const { role } = v.params(req, v.z.object({ role: v.z.enum(ROLES) }));
  res.json(await db.all('SELECT id, first_name, last_name, badge_number, role, roles FROM users WHERE ? = ANY(roles) AND active = 1 ORDER BY last_name', [role]));
}));

const createSchema = v.z.object({
  first_name: v.str(100),
  last_name: v.str(100),
  badge_number: v.z.string().trim().toUpperCase().min(1).max(64),
  email: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().email().max(200).nullable().optional()),
  role: v.z.enum(ROLES).optional(),
  roles: v.z.array(v.z.enum(ROLES)).min(1).max(ROLES.length).optional(),
  password,
}).refine((b) => b.role || b.roles, { message: 'At least one role is required', path: ['roles'] });

/**
 * Primary role + all roles. "role" alone (older clients) means exactly that
 * one role; with "roles", the primary role is kept if still included.
 */
function resolveRoles(b, current) {
  if (!b.roles) return b.role ? { role: b.role, roles: [b.role] } : current;
  const roles = [...new Set(b.roles)];
  const primary = b.role && roles.includes(b.role) ? b.role
    : current && roles.includes(current.role) ? current.role : roles[0];
  return { role: primary, roles };
}

// POST /api/users — create user (admin only)
router.post('/', requireRole('administrator'), h(async (req, res) => {
  const b = v.body(req, createSchema);
  const hash = await bcrypt.hash(b.password, 10);
  const row = await db.get(
    'INSERT INTO users (first_name, last_name, badge_number, email, role, roles, password_hash) VALUES (?,?,?,?,?,?,?) RETURNING id',
    [b.first_name, b.last_name, b.badge_number, b.email ?? null, ...Object.values(resolveRoles(b)), hash],
  );
  res.status(201).json({ id: row.id, message: 'User created' });
}));

const updateSchema = v.z.object({
  first_name: v.str(100).optional(),
  last_name: v.str(100).optional(),
  email: v.z.preprocess((x) => (x === '' ? null : x), v.z.string().email().max(200).nullable().optional()),
  role: v.z.enum(ROLES).optional(),
  roles: v.z.array(v.z.enum(ROLES)).min(1).max(ROLES.length).optional(),
  active: v.flag.optional(),
  password: v.z.preprocess((x) => (x === '' || x === null ? undefined : x), password.optional()),
});

// PUT /api/users/:id
router.put('/:id', requireRole('administrator'), h(async (req, res) => {
  const id = v.paramId(req);
  const b = v.body(req, updateSchema);
  const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) throw notFound('User');
  const next = resolveRoles(b, { role: user.role, roles: user.roles });
  if (id === req.user.id && (b.active === 0 || !next.roles.includes('administrator'))) {
    throw badRequest('You cannot deactivate yourself or remove your own administrator role');
  }
  const hash = b.password ? await bcrypt.hash(b.password, 10) : user.password_hash;
  await db.run(
    `UPDATE users SET first_name=?, last_name=?, email=?, role=?, roles=?, active=?, password_hash=?${b.password ? ', token_version = token_version + 1' : ''} WHERE id=?`,
    [b.first_name ?? user.first_name, b.last_name ?? user.last_name, b.email !== undefined ? b.email : user.email,
      next.role, next.roles, b.active ?? user.active, hash, id],
  );
  res.json({ message: 'User updated' });
}));

// DELETE /api/users/:id (deactivate)
router.delete('/:id', requireRole('administrator'), h(async (req, res) => {
  const id = v.paramId(req);
  if (id === req.user.id) throw badRequest('You cannot deactivate yourself');
  const r = await db.run('UPDATE users SET active = 0 WHERE id = ?', [id]);
  if (!r.rowCount) throw notFound('User');
  res.json({ message: 'User deactivated' });
}));

// ─── Legacy shift endpoints (kept for compatibility; see routes/shifts.js) ──

// GET /api/users/shifts/all
router.get('/shifts/all', h(async (req, res) => {
  const shifts = await db.all('SELECT * FROM shifts ORDER BY id');
  const members = await db.all(`
    SELECT sm.shift_id, u.id, u.first_name, u.last_name, u.badge_number, u.role
    FROM shift_members sm JOIN users u ON sm.user_id = u.id`);
  const users = await db.all('SELECT id, first_name, last_name, badge_number FROM users');
  const byId = new Map(users.map((u) => [u.id, u]));
  res.json(shifts.map((s) => ({
    ...s,
    responsible: byId.get(s.shift_responsible_id),
    members: members.filter((m) => m.shift_id === s.id).map(({ shift_id, ...m }) => m),
  })));
}));

// POST /api/users/shifts
router.post('/shifts', requireRole('area_supervisor', 'administrator'), h(async (req, res) => {
  const b = v.body(req, v.z.object({
    name: v.str(100),
    shift_responsible_id: v.id,
    operator_ids: v.z.array(v.id).optional(),
  }));
  const shift = await db.get('INSERT INTO shifts (name, shift_responsible_id) VALUES (?,?) RETURNING id', [b.name, b.shift_responsible_id]);
  for (const uid of [b.shift_responsible_id, ...(b.operator_ids || [])]) {
    await db.run('INSERT INTO shift_members (shift_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING', [shift.id, uid]);
  }
  res.status(201).json({ id: shift.id, message: 'Shift created' });
}));

// POST /api/users/shifts/:id/move-operator
router.post('/shifts/:id/move-operator', requireRole('area_supervisor', 'administrator'), h(async (req, res) => {
  const b = v.body(req, v.z.object({ user_id: v.id, target_shift_id: v.id }));
  await db.run('DELETE FROM shift_members WHERE user_id = ?', [b.user_id]);
  await db.run('INSERT INTO shift_members (shift_id, user_id) VALUES (?,?) ON CONFLICT DO NOTHING', [b.target_shift_id, b.user_id]);
  res.json({ message: 'Operator moved' });
}));

// DELETE /api/users/shifts/:id
router.delete('/shifts/:id', requireRole('area_supervisor', 'administrator'), h(async (req, res) => {
  await db.run('DELETE FROM shifts WHERE id = ?', [v.paramId(req)]);
  res.json({ message: 'Shift deleted' });
}));

// ─── Skills ─────────────────────────────────────────────────────────────────

// GET /api/users/:id/skills
router.get('/:id/skills', h(async (req, res) => {
  res.json(await db.all(`
    SELECT os.*, m.name AS machine_name
    FROM operator_skills os JOIN machines m ON os.machine_id = m.id
    WHERE os.user_id = ?`, [v.paramId(req)]));
}));

// POST /api/users/:id/skills — replace a user's skills
router.post('/:id/skills', requireRole('administrator', 'area_supervisor'), h(async (req, res) => {
  const userId = v.paramId(req);
  const { skills } = v.body(req, v.z.object({
    skills: v.z.array(v.z.object({
      machine_id: v.id,
      skill_level: v.z.enum(['trainee', 'independent', 'expert']).default('independent'),
      expiration_date: v.optDate,
    })),
  }));
  if (!(await db.get('SELECT id FROM users WHERE id = ?', [userId]))) throw notFound('User');
  await db.run('DELETE FROM operator_skills WHERE user_id = ?', [userId]);
  for (const s of skills) {
    await db.run(
      'INSERT INTO operator_skills (user_id, machine_id, skill_level, expiration_date) VALUES (?, ?, ?, ?)',
      [userId, s.machine_id, s.skill_level, s.expiration_date ?? null],
    );
  }
  res.json({ message: 'Skills updated' });
}));

module.exports = router;
