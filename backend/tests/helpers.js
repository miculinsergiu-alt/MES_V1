/**
 * Test helpers: an in-memory PostgreSQL (PGlite) per test file, plus
 * shortcuts to create companies and log in.
 */
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const request = require('supertest');
const db = require('../db');
const app = require('../app');
const { createCompany } = require('../scripts/companies');

const PASSWORD = 'test-password-123';

async function setup() {
  await db.initDb({ memory: true });
}

async function teardown() {
  await db.closeDb();
}

/** Creates a company and returns { company, token, api } logged in as its admin. */
async function companyWithAdmin(code) {
  const { company } = await createCompany({
    code,
    name: `${code} GmbH`,
    admin: { badge_number: 'ADMIN001', password: PASSWORD },
  });
  const token = await login(code, 'ADMIN001', PASSWORD);
  return { company, token, api: client(token) };
}

async function login(companyCode, badge, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ company_code: companyCode, badge_number: badge, password });
  if (res.status !== 200) throw new Error(`Login failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.token;
}

/** Small API client bound to a token: api.get(url), api.post(url, body), ... */
function client(token) {
  const withAuth = (r) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
  return {
    get: (url) => withAuth(request(app).get(url)),
    post: (url, body) => withAuth(request(app).post(url)).send(body ?? {}),
    put: (url, body) => withAuth(request(app).put(url)).send(body ?? {}),
    delete: (url) => withAuth(request(app).delete(url)),
  };
}

/** Creates a user via the API and returns a client logged in as that user. */
async function userClient(adminApi, companyCode, badge, role) {
  const res = await adminApi.post('/api/users', { first_name: 'Test', last_name: role, badge_number: badge, role, password: PASSWORD });
  if (res.status !== 201) throw new Error(`Create user failed: ${JSON.stringify(res.body)}`);
  return { id: res.body.id, api: client(await login(companyCode, badge)) };
}

/** Creates an area and a machine; returns the machine id. */
async function createMachine(api, name = 'CNC 1') {
  const area = await api.post('/api/machines/areas', { name: `Area for ${name}` });
  const machine = await api.post('/api/machines', { area_id: area.body.id, name });
  if (machine.status !== 201) throw new Error(`Create machine failed: ${JSON.stringify(machine.body)}`);
  return machine.body.id;
}

async function createItem(api, item_code, type, extra = {}) {
  const res = await api.post('/api/items', { item_code, name: item_code, type, ...extra });
  if (res.status !== 201) throw new Error(`Create item failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

module.exports = { app, db, request, setup, teardown, companyWithAdmin, login, client, userClient, createMachine, createItem, PASSWORD };
