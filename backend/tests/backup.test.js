/**
 * Backup -> restore round trip into a fresh database, with real business data.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const t = require('./helpers');
const db = require('../db');
const { createBackup, restoreBackup, decrypt } = require('../lib/backup');

const KEY = 'test-backup-passphrase-123';
let backup;

before(async () => {
  await t.setup();
  const a = await t.companyWithAdmin('BKA');
  await t.companyWithAdmin('BKB');
  await a.api.post('/api/customers', { name: 'Kunde Backup GmbH' }).expect(201);
  backup = await createBackup(KEY);
});
after(t.teardown);

test('backup is encrypted and needs the right key', () => {
  assert.equal(backup.file.subarray(0, 7).toString(), 'NOVABK1');
  assert.ok(!backup.file.includes(Buffer.from('Kunde Backup GmbH')));
  assert.throws(() => decrypt(backup.file, 'wrong-passphrase-0000'), /cannot be decrypted/);
  assert.ok(backup.counts.companies >= 2);
});

test('restore into a fresh database brings back all rows, logins work, ids continue', async () => {
  await db.closeDb();
  await db.initDb({ memory: true });
  const counts = await restoreBackup(backup.file, KEY);
  assert.deepEqual(counts, backup.counts);

  const token = await t.login('BKA', 'ADMIN001');
  const api = t.client(token);
  const list = await api.get('/api/customers').expect(200);
  const rows = Array.isArray(list.body) ? list.body : list.body.items || list.body.rows || [];
  assert.ok(JSON.stringify(rows).includes('Kunde Backup GmbH'));
  // Sequences were moved forward: new records get fresh ids
  await api.post('/api/customers', { name: 'Neu nach Restore' }).expect(201);
  // Company separation still holds after restore
  const other = t.client(await t.login('BKB', 'ADMIN001'));
  assert.ok(!JSON.stringify((await other.get('/api/customers')).body).includes('Kunde Backup GmbH'));

  await assert.rejects(restoreBackup(backup.file, KEY), /not empty/);
});
