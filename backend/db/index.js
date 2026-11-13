/**
 * Database access layer (PostgreSQL).
 *
 * - Production: real PostgreSQL via DATABASE_URL (node-postgres pool).
 * - Development / tests: embedded PostgreSQL (PGlite), no install needed.
 *
 * Every query runs inside a *context* (see withContext): one transaction with
 * the current company id set as a session variable. Row-level security
 * policies in the database use that variable, so a request can only ever see
 * and change its own company's rows — even if a query forgets a WHERE clause.
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || 'Europe/Berlin';
const APP_ROLE = 'nova_app';

const als = new AsyncLocalStorage();
let driver = null;

// ─── Drivers ────────────────────────────────────────────────────────────────

function createPgDriver(connectionString) {
  const { Pool, Client, types } = require('pg');
  // Return BIGINT (COUNT/SUM) and NUMERIC as JS numbers instead of strings.
  types.setTypeParser(20, (v) => parseInt(v, 10));
  types.setTypeParser(1700, (v) => parseFloat(v));

  // SSL: on when DATABASE_SSL=true or the URL asks for it (sslmode=require).
  // Private networks of the hosting provider (e.g. Render internal URLs) run without SSL.
  const wantsSsl = process.env.DATABASE_SSL === 'true' || /sslmode=(require|verify)/.test(connectionString);
  const ssl = wantsSsl ? { rejectUnauthorized: process.env.DATABASE_SSL_VERIFY === 'true' } : false;

  let useAppRole = false;
  const pool = new Pool({ connectionString, ssl, max: Number(process.env.DATABASE_POOL_SIZE || 10) });
  pool.on('connect', (client) => {
    if (useAppRole) client.query(`SET ROLE ${APP_ROLE}`).catch(() => {});
  });

  return {
    kind: 'postgres',
    async connect() {
      const client = await pool.connect();
      return {
        query: (text, params) => client.query(text, params),
        exec: (text) => client.query(text),
        release: () => client.release(),
      };
    },
    async admin(fn) {
      const client = new Client({ connectionString, ssl });
      await client.connect();
      try {
        return await fn({ query: (t, p) => client.query(t, p), exec: (t) => client.query(t) });
      } finally {
        await client.end();
      }
    },
    setUseAppRole(v) { useAppRole = v; },
    async close() { await pool.end(); },
  };
}

function createPgliteDriver(dataDir) {
  const { PGlite } = require('@electric-sql/pglite');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir || undefined);

  // PGlite is a single connection: serialize sessions so transactions and
  // session variables of concurrent requests never interleave.
  let chain = Promise.resolve();
  const acquire = () => {
    let release;
    const next = new Promise((r) => { release = r; });
    const ready = chain.then(() => release);
    chain = chain.then(() => next);
    return ready;
  };
  const wrap = () => ({
    query: async (text, params) => {
      const r = await pg.query(text, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    exec: (text) => pg.exec(text),
  });

  return {
    kind: 'pglite',
    async connect() {
      const release = await acquire();
      return { ...wrap(), release };
    },
    async admin(fn) {
      const release = await acquire();
      try { return await fn(wrap()); } finally { release(); }
    },
    async setUseAppRole(v) {
      const release = await acquire();
      try { await pg.exec(v ? `SET ROLE ${APP_ROLE}` : 'RESET ROLE'); } finally { release(); }
    },
    async close() { await pg.close(); },
  };
}

// ─── Initialisation ─────────────────────────────────────────────────────────

/**
 * Connects, runs pending migrations and makes sure row-level security is
 * actually enforced for the connection the app uses. Refuses to start if not.
 */
async function initDb({ databaseUrl = process.env.DATABASE_URL, dataDir, memory = false } = {}) {
  if (driver) return driver;
  if (databaseUrl) {
    driver = createPgDriver(databaseUrl);
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL must be set in production.');
    }
    const dir = memory ? null : (dataDir || process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'pglite'));
    driver = createPgliteDriver(dir);
  }

  const { runMigrations } = require('./migrate');
  const isSuperuser = await driver.admin(async (conn) => {
    await runMigrations(conn);
    const { rows } = await conn.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
    if (rows[0]?.rolsuper) {
      // Superusers bypass row-level security entirely, so the app switches to
      // an unprivileged role for all normal work.
      await conn.exec(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
            CREATE ROLE ${APP_ROLE} NOLOGIN;
          END IF;
        END $$;
        GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
        GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${APP_ROLE};
      `);
      return true;
    }
    return false;
  });
  if (isSuperuser) await driver.setUseAppRole(true);

  // Safety check: with no company selected, a protected table must look empty
  // to the app. If row-level security is bypassed, refuse to run.
  const leak = await withContext({}, async () => {
    const r = await get(`SELECT row_security_active('users') AS active`);
    return !r.active;
  });
  if (leak) {
    throw new Error('Row-level security is not active for the database user. Refusing to start: data of different companies would not be separated.');
  }
  return driver;
}

async function closeDb() {
  if (driver) await driver.close();
  driver = null;
}

// ─── Context & queries ──────────────────────────────────────────────────────

class RollbackSignal extends Error {}

/**
 * Runs fn inside one database transaction.
 * ctx: { companyId, userId, system, timezone }
 *  - companyId: rows visible/writable are limited to this company.
 *  - system: bypasses company separation (login lookup, migrations, admin scripts).
 */
async function withContext(ctx, fn) {
  if (!driver) throw new Error('Database not initialised. Call initDb() first.');
  const outer = als.getStore();
  if (outer) {
    // Already inside a transaction (e.g. nested helper): reuse it.
    return fn();
  }
  const conn = await driver.connect();
  const state = { conn, ctx, afterCommit: [] };
  try {
    await conn.query('BEGIN');
    await conn.query(
      `SELECT set_config('app.company_id', $1, true),
              set_config('app.user_id', $2, true),
              set_config('app.system', $3, true),
              set_config('TimeZone', $4, true)`,
      [
        ctx.companyId ? String(ctx.companyId) : '',
        ctx.userId ? String(ctx.userId) : '',
        ctx.system ? 'on' : 'off',
        ctx.timezone || DEFAULT_TIMEZONE,
      ],
    );
    let result;
    let rollback = false;
    try {
      result = await als.run(state, fn);
    } catch (err) {
      if (!(err instanceof RollbackSignal)) throw err;
      rollback = true;
      result = err.value;
    }
    await conn.query(rollback ? 'ROLLBACK' : 'COMMIT');
    if (!rollback) {
      for (const cb of state.afterCommit) {
        try { cb(); } catch (e) { console.error('[db] afterCommit callback failed:', e); }
      }
    }
    return result;
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Throw inside withContext to roll back but still return a value. */
function rollbackWith(value) {
  const s = new RollbackSignal('rollback');
  s.value = value;
  return s;
}

/** Register a callback to run only if the current transaction commits. */
function afterCommit(cb) {
  const state = als.getStore();
  if (state) state.afterCommit.push(cb);
  else cb();
}

function currentContext() {
  return als.getStore()?.ctx || null;
}

/** Converts `?` placeholders to PostgreSQL `$1, $2, ...`. */
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(sql, params = []) {
  const state = als.getStore();
  if (!state) throw new Error('Database query outside of a context. Wrap the call in withContext().');
  const normalized = params.map((p) => (p === undefined ? null : p));
  return state.conn.query(toPg(sql), normalized);
}

/** All rows. */
async function all(sql, params) {
  return (await query(sql, params)).rows;
}

/** First row or undefined. */
async function get(sql, params) {
  return (await query(sql, params)).rows[0];
}

/** Executes a statement; returns { rowCount, rows }. Use RETURNING for ids. */
async function run(sql, params) {
  const r = await query(sql, params);
  return { rowCount: r.rowCount, rows: r.rows };
}

module.exports = {
  initDb,
  closeDb,
  withContext,
  rollbackWith,
  afterCommit,
  currentContext,
  query,
  all,
  get,
  run,
  DEFAULT_TIMEZONE,
};
