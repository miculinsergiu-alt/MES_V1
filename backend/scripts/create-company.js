/**
 * Creates a new customer company with its first administrator.
 *
 *   node scripts/create-company.js --code ACME --name "Acme GmbH" \
 *     --admin-badge ADMIN001 --admin-first Max --admin-last Mustermann --admin-email max@acme.de
 *
 * The admin password is read from the NOVA_ADMIN_PASSWORD environment variable
 * (so it does not end up in the shell history). Minimum 12 characters.
 */
const { parseArgs } = require('node:util');
const db = require('../db');
const { createCompany } = require('./companies');

async function main() {
  const { values } = parseArgs({
    options: {
      code: { type: 'string' },
      name: { type: 'string' },
      timezone: { type: 'string', default: 'Europe/Berlin' },
      'admin-badge': { type: 'string', default: 'ADMIN001' },
      'admin-first': { type: 'string', default: 'Admin' },
      'admin-last': { type: 'string' },
      'admin-email': { type: 'string' },
    },
  });
  const password = process.env.NOVA_ADMIN_PASSWORD;
  if (!values.code || !values.name) throw new Error('--code and --name are required');
  if (!password || password.length < 12) throw new Error('Set NOVA_ADMIN_PASSWORD (at least 12 characters)');

  await db.initDb();
  const { company, admin } = await createCompany({
    code: values.code,
    name: values.name,
    timezone: values.timezone,
    admin: {
      badge_number: values['admin-badge'],
      first_name: values['admin-first'],
      last_name: values['admin-last'] || values.name,
      email: values['admin-email'],
      password,
    },
  });
  console.log(`Created company ${company.code} (id ${company.id}) with administrator ${admin.badge_number}.`);
  await db.closeDb();
}

main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
