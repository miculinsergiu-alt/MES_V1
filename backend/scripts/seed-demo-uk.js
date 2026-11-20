/**
 * UK demo company for sales demos with British job shops (GBP, en-GB, Europe/London, 20% VAT).
 *
 *   node scripts/seed-demo-uk.js     (creates company DEMOUK and fills it with sample data)
 *
 * Demo passwords are public. Never run this against a production database
 * that real customers use.
 */
const bcrypt = require('bcryptjs');
const db = require('../db');
const { createCompany } = require('./companies');

const CODE = 'NOVAGB';
const PASSWORD = 'demo1234';
const USERS = [
  ['Laura', 'Planner', 'PLN001', 'planner'],
  ['Emma', 'Supervisor', 'SPV001', 'area_supervisor'],
  ['Andrew', 'Shiftlead', 'SHR001', 'shift_responsible'],
  ['Jack', 'Operator', 'OPR001', 'operator'],
  ['Mia', 'Operator', 'OPR002', 'operator'],
  ['Victor', 'Stores', 'WHM001', 'warehouse_manager'],
  ['Anna', 'Materials', 'MAT001', 'material_planner'],
  ['Sophie', 'Sales', 'VK001', 'sales'],
  ['Tom', 'Accounts', 'FIB001', 'accounting'],
];

async function seedDemoUK() {
  const exists = await db.withContext({ system: true }, () => db.get('SELECT id FROM companies WHERE code = ?', [CODE]));
  if (exists) return null;
  const { company } = await createCompany({
    code: CODE,
    name: 'NOVA Demo Engineering Ltd',
    timezone: 'Europe/London',
    admin: { first_name: 'Admin', last_name: 'Demo', badge_number: 'ADMIN001', password: PASSWORD },
    onboardingCompleted: 1,
  });
  // Country GB (set with the company settings in demoDataUK) brings GBP; locale for number formats.
  await db.withContext({ system: true }, () => db.run("UPDATE companies SET locale = 'en-GB' WHERE id = ?", [company.id]));
  const hash = await bcrypt.hash(PASSWORD, 10);
  await db.withContext({ companyId: company.id }, async () => {
    for (const [first, last, badge, role] of USERS) {
      await db.run('INSERT INTO users (first_name, last_name, badge_number, role, password_hash) VALUES (?, ?, ?, ?, ?)',
        [first, last, badge, role, hash]);
    }
  });
  return company;
}

module.exports = { seedDemoUK, UKDEMO_CODE: CODE };

if (require.main === module) {
  (async () => {
    await db.initDb();
    await seedDemoUK();
    const c = await db.withContext({ system: true }, () => db.get('SELECT id FROM companies WHERE code = ?', [CODE]));
    const filled = await db.withContext({ companyId: c.id }, () => db.get('SELECT COUNT(*) AS n FROM customers'));
    if (Number(filled.n) > 0) { console.log(`Company ${CODE} already has data.`); await db.closeDb(); return; }
    const app = require('../app');
    const { populateDemo } = require('../services/demoDataUK');
    const r = await populateDemo(app, { code: CODE, password: PASSWORD });
    console.log(`Created ${CODE}: ${r.customers} customers, ${r.orders} orders. Log in with company code ${CODE}, badge ADMIN001, password ${PASSWORD}.`);
    await db.closeDb();
  })().catch((err) => { console.error(err.message); process.exit(1); });
}
