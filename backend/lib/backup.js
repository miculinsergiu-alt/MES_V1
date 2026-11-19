/**
 * Full database backup and restore (all companies), independent of the
 * hosting provider: an extra off-site copy next to the provider's own
 * backups, so invoices stay available for the 10 years GoBD requires.
 *
 * Format: JSON -> gzip -> AES-256-GCM (key derived from a passphrase with
 * scrypt). File layout: "NOVABK1" | salt(16) | iv(12) | tag(16) | ciphertext.
 */
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const db = require('./../db');

const MAGIC = Buffer.from('NOVABK1');
const SKIP_TABLES = new Set(['schema_migrations']);

async function tableInfo() {
  const cols = await db.all(`
    SELECT table_name, column_name, data_type, is_generated, identity_generation
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`);
  const tables = {};
  for (const c of cols) {
    if (SKIP_TABLES.has(c.table_name)) continue;
    (tables[c.table_name] ||= []).push(c);
  }
  const baseTables = new Set((await db.all(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  )).map((r) => r.table_name));
  for (const t of Object.keys(tables)) if (!baseTables.has(t)) delete tables[t];
  return tables;
}

/** Foreign keys with their columns and whether all of those columns are NOT NULL. */
async function foreignKeys(tables) {
  const rows = await db.all(`
    SELECT c.conname, cl.relname AS child, pl.relname AS parent, a.attname AS col, a.attnotnull AS notnull
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_class pl ON pl.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND n.nspname = 'public'`);
  const byName = {};
  for (const r of rows) {
    if (!tables[r.child] || !tables[r.parent]) continue;
    const fk = (byName[`${r.child}.${r.conname}`] ||= { child: r.child, parent: r.parent, cols: [], nullableCols: [] });
    fk.cols.push(r.col);
    if (!r.notnull) fk.nullableCols.push(r.col);
  }
  return Object.values(byName);
}

/**
 * Tables ordered so that referenced tables come first. Only required
 * references (no nullable column) decide the order; nullable references that
 * would point "forward" are filled in afterwards (see `deferred`).
 */
async function dependencyOrder(tables) {
  const fks = await foreignKeys(tables);
  const deps = Object.fromEntries(Object.keys(tables).map((t) => [t, new Set()]));
  for (const fk of fks) if (fk.child !== fk.parent && !fk.nullableCols.length) deps[fk.child].add(fk.parent);
  const order = []; const state = {};
  const visit = (t, path) => {
    if (state[t] === 'done') return;
    if (state[t] === 'busy') throw new Error(`Circular foreign keys: ${[...path, t].join(' -> ')}`);
    state[t] = 'busy';
    for (const p of [...deps[t]].sort()) visit(p, [...path, t]);
    state[t] = 'done'; order.push(t);
  };
  for (const t of Object.keys(tables).sort()) visit(t, []);
  // Nullable FK columns whose parent is restored later (or is the same table):
  // inserted as NULL first, set by UPDATE once all rows exist.
  const pos = Object.fromEntries(order.map((t, i) => [t, i]));
  const deferred = {};
  for (const fk of fks) {
    if (fk.nullableCols.length && pos[fk.parent] >= pos[fk.child]) {
      const set = (deferred[fk.child] ||= new Set());
      fk.nullableCols.forEach((c) => set.add(c));
    }
  }
  return { order, deferred: Object.fromEntries(Object.entries(deferred).map(([t, s]) => [t, [...s]])) };
}

// bytea comes back as Buffer (pg) or Uint8Array (PGlite).
const encodeValue = (v) => (v instanceof Uint8Array ? { $bytes: Buffer.from(v).toString('base64') } : v instanceof Date ? v.toISOString() : v);
const decodeValue = (v, type) => {
  if (v && typeof v === 'object' && v.$bytes !== undefined) return Buffer.from(v.$bytes, 'base64');
  if (v !== null && (type === 'json' || type === 'jsonb')) return JSON.stringify(v);
  return v;
};

/** Reads every table (system context, all companies). */
async function collect() {
  return db.withContext({ system: true }, async () => {
    const tables = await tableInfo();
    const { order } = await dependencyOrder(tables);
    const data = {};
    for (const t of order) {
      const rows = await db.all(`SELECT * FROM "${t}"`);
      data[t] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, encodeValue(v)])));
    }
    const migrations = (await db.all('SELECT name FROM schema_migrations ORDER BY name')).map((r) => r.name);
    return { format: 1, created_at: new Date().toISOString(), migrations, order, data };
  });
}

function keyFrom(passphrase, salt) {
  if (!passphrase || passphrase.length < 16) throw new Error('BACKUP_KEY must be at least 16 characters');
  return crypto.scryptSync(passphrase, salt, 32);
}

function encrypt(obj, passphrase) {
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(zlib.gzipSync(JSON.stringify(obj))), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

function decrypt(buf, passphrase) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a NOVA backup file');
  let o = MAGIC.length;
  const salt = buf.subarray(o, o += 16); const iv = buf.subarray(o, o += 12); const tag = buf.subarray(o, o += 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return JSON.parse(zlib.gunzipSync(Buffer.concat([decipher.update(buf.subarray(o)), decipher.final()])).toString('utf8'));
  } catch {
    throw new Error('Backup cannot be decrypted (wrong BACKUP_KEY or damaged file)');
  }
}

async function createBackup(passphrase) {
  const content = await collect();
  const counts = Object.fromEntries(Object.entries(content.data).map(([t, rows]) => [t, rows.length]));
  return { file: encrypt(content, passphrase), counts };
}

/**
 * Restores a backup into an EMPTY database (migrations already applied).
 * Everything runs in one transaction: it either restores fully or not at all.
 */
async function restoreBackup(buf, passphrase) {
  const content = decrypt(buf, passphrase);
  // Owner connection: the GoBD protection triggers (locked documents,
  // write-once archive) must be off while the rows are re-created as they were.
  // ALTER TABLE is transactional, so they are back on at commit or rollback.
  return db.withOwnerTransaction(async () => {
    const existing = await db.get('SELECT count(*)::int AS n FROM companies');
    if (existing.n > 0) throw new Error('Target database is not empty; restore only into a fresh database');
    const applied = new Set((await db.all('SELECT name FROM schema_migrations')).map((r) => r.name));
    const missing = content.migrations.filter((m) => !applied.has(m));
    if (missing.length) throw new Error(`Target database lacks migrations: ${missing.join(', ')}`);

    const tables = await tableInfo();
    for (const t of Object.keys(content.data)) {
      if (content.data[t].length && !tables[t]) throw new Error(`Table ${t} does not exist in the target database`);
    }
    // Order is computed on the target schema (same migrations), not taken from the file.
    const { order, deferred } = await dependencyOrder(tables);
    const counts = {};
    const later = [];
    for (const t of order) await db.run(`ALTER TABLE "${t}" DISABLE TRIGGER USER`);
    for (const t of order) {
      const rows = content.data[t] || [];
      counts[t] = rows.length;
      if (!rows.length) continue;
      const types = Object.fromEntries(tables[t].map((c) => [c.column_name, c.data_type]));
      const writable = tables[t].filter((c) => c.is_generated !== 'ALWAYS').map((c) => c.column_name);
      const identityAlways = tables[t].some((c) => c.identity_generation === 'ALWAYS');
      const defer = deferred[t] || [];
      for (const r of rows) {
        const cols = writable.filter((c) => c in r);
        await db.run(
          `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(',')})${identityAlways ? ' OVERRIDING SYSTEM VALUE' : ''} VALUES (${cols.map(() => '?').join(',')})`,
          cols.map((c) => (defer.includes(c) ? null : decodeValue(r[c], types[c]))),
        );
        const toSet = defer.filter((c) => r[c] !== null && r[c] !== undefined);
        if (toSet.length) {
          if (r.id === undefined) throw new Error(`Cannot restore ${t}: deferred references need an id column`);
          later.push([`UPDATE "${t}" SET ${toSet.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`, [...toSet.map((c) => r[c]), r.id]]);
        }
      }
    }
    for (const [sql, params] of later) await db.run(sql, params);
    for (const t of order) await db.run(`ALTER TABLE "${t}" ENABLE TRIGGER USER`);
    // Move every id sequence past the restored ids.
    const seqs = await db.all(`
      SELECT c.table_name, c.column_name, pg_get_serial_sequence(format('%I', c.table_name), c.column_name) AS seq
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND pg_get_serial_sequence(format('%I', c.table_name), c.column_name) IS NOT NULL`);
    for (const s of seqs) {
      await db.get(`SELECT setval('${s.seq}', GREATEST((SELECT COALESCE(MAX("${s.column_name}"), 0) FROM "${s.table_name}"), 1), (SELECT COUNT(*) > 0 FROM "${s.table_name}"))`);
    }
    return counts;
  });
}

module.exports = { createBackup, restoreBackup, decrypt };
