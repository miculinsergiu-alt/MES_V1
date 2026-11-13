/**
 * Demo company for local development and sales demos.
 *
 *   node scripts/seed-demo.js     (creates company DEMO if it does not exist)
 *
 * Demo passwords are public. Never run this against a production database
 * that real customers use.
 */
const bcrypt = require('bcryptjs');
const db = require('../db');
const { createCompany } = require('./companies');

const DEMO_CODE = 'DEMO';
const DEMO_PASSWORD = 'demo1234';
const DEMO_USERS = [
  ['Lena', 'Planer', 'PLN001', 'planner'],
  ['Elena', 'Aufsicht', 'SPV001', 'area_supervisor'],
  ['Andreas', 'Schichtleiter', 'SHR001', 'shift_responsible'],
  ['Jonas', 'Bediener', 'OPR001', 'operator'],
  ['Maria', 'Bediener', 'OPR002', 'operator'],
  ['Viktor', 'Lager', 'WHM001', 'warehouse_manager'],
  ['Anna', 'Disposition', 'MAT001', 'material_planner'],
];

async function seedDemo() {
  const exists = await db.withContext({ system: true }, () => db.get('SELECT id FROM companies WHERE code = ?', [DEMO_CODE]));
  if (exists) return null;

  const { company } = await createCompany({
    code: DEMO_CODE,
    name: 'NOVA Demo GmbH',
    admin: { first_name: 'Admin', last_name: 'Demo', badge_number: 'ADMIN001', password: DEMO_PASSWORD },
    onboardingCompleted: 1,
  });
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await db.withContext({ companyId: company.id }, async () => {
    for (const [first, last, badge, role] of DEMO_USERS) {
      await db.run('INSERT INTO users (first_name, last_name, badge_number, role, password_hash) VALUES (?, ?, ?, ?, ?)',
        [first, last, badge, role, hash]);
    }
  });
  return company;
}

/** Called on dev server start: seed only when the database has no companies at all. */
async function seedDemoIfEmpty() {
  const any = await db.withContext({ system: true }, () => db.get('SELECT id FROM companies LIMIT 1'));
  if (any) return;
  const company = await seedDemo();
  if (company) {
    console.log(`\nDemo company created. Log in with company code "${DEMO_CODE}", badge ADMIN001 (or PLN001, SPV001, SHR001, OPR001, WHM001, MAT001), password "${DEMO_PASSWORD}".\n`);
  }
}

module.exports = { seedDemo, seedDemoIfEmpty, DEMO_CODE, DEMO_PASSWORD };

if (require.main === module) {
  (async () => {
    await db.initDb();
    const company = await seedDemo();
    console.log(company ? `Created demo company ${DEMO_CODE}.` : `Demo company ${DEMO_CODE} already exists.`);
    await db.closeDb();
  })().catch((err) => { console.error(err.message); process.exit(1); });
}
