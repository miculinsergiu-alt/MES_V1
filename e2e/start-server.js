/**
 * Starts NOVA for the browser tests: fresh embedded database in a temp
 * folder, demo company seeded, built frontend served on E2E_PORT.
 * Run `npm run build` first.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-e2e-'));
process.env.PGLITE_DIR = dir;
process.env.PORT = process.env.E2E_PORT || '3101';
process.env.NODE_ENV = 'development';
process.env.DEMO_LOGIN = process.env.DEMO_LOGIN || 'false'; // specs create their own data in DEMO
delete process.env.DATABASE_URL;

const backend = path.join(__dirname, '..', 'backend');
execFileSync(process.execPath, [path.join(backend, 'scripts', 'seed-demo.js')], { stdio: 'inherit', env: process.env, cwd: backend });
process.chdir(backend);
require(path.join(backend, 'server.js'));
