/**
 * Creating companies (tenants) and their first administrator.
 */
const bcrypt = require('bcryptjs');
const db = require('../db');

const DEFAULT_DEFECT_REASONS = ['Maßabweichung', 'Oberflächenfehler / Kratzer', 'Materialfehler', 'Montagefehler', 'Sonstiges'];
const DEFAULT_DELAY_REASONS = [
  ['Materialmangel', 'material'],
  ['Maschinenstörung', 'machine'],
  ['Personalmangel', 'personnel'],
  ['Rüstzeit überschritten', 'setup'],
  ['Qualitätsproblem', 'quality'],
  ['Sonstiges', 'general'],
];

/**
 * Creates a company with an administrator and default reason lists.
 * Returns { company, admin }.
 */
async function createCompany({ code, name, timezone = 'Europe/Berlin', admin }) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(normalizedCode)) {
    throw new Error('Company code must be 2-32 characters: letters, digits, "-" or "_"');
  }
  if (!name) throw new Error('Company name is required');
  if (!admin?.password || admin.password.length < 8) throw new Error('Admin password must be at least 8 characters');

  const passwordHash = await bcrypt.hash(admin.password, 10);

  const company = await db.withContext({ system: true }, () => db.get(
    'INSERT INTO companies (code, name, timezone) VALUES (?, ?, ?) RETURNING *', [normalizedCode, name, timezone]));

  const adminUser = await db.withContext({ companyId: company.id, timezone }, async () => {
    for (const reason of DEFAULT_DEFECT_REASONS) {
      await db.run('INSERT INTO defect_reasons (name) VALUES (?) ON CONFLICT DO NOTHING', [reason]);
    }
    for (const [reason, category] of DEFAULT_DELAY_REASONS) {
      await db.run('INSERT INTO delay_reasons (name, category) VALUES (?, ?) ON CONFLICT DO NOTHING', [reason, category]);
    }
    return db.get(`
      INSERT INTO users (first_name, last_name, badge_number, email, role, password_hash)
      VALUES (?, ?, ?, ?, 'administrator', ?) RETURNING id, badge_number`,
    [admin.first_name || 'Admin', admin.last_name || name, String(admin.badge_number || 'ADMIN001').toUpperCase(), admin.email || null, passwordHash]);
  });

  return { company, admin: adminUser };
}

module.exports = { createCompany, DEFAULT_DEFECT_REASONS, DEFAULT_DELAY_REASONS };
