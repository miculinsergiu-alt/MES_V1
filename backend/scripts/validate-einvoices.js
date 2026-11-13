/**
 * Validates e-invoices with the official tools:
 *  - XRechnung XML: KoSIT validator with the XRechnung configuration
 *    (https://github.com/itplr-kosit/validator)
 *  - ZUGFeRD PDF: Mustang CLI (PDF/A-3 via veraPDF + EN 16931 rules)
 *    (https://github.com/ZUGFeRD/mustangproject)
 *
 *   node scripts/validate-einvoices.js file1.xml file2.pdf ...
 *
 * Tools folder (NOVA_TOOLS, default ../../nova-tools) must contain:
 *   jdk-*/bin/java(.exe)            Java 17+ (or java on PATH)
 *   kosit-validator.jar             validator-<version>-standalone.jar
 *   xrechnung-config/scenarios.xml  unzipped XRechnung validator configuration
 *   mustang-cli.jar                 Mustang-CLI-<version>.jar
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tools = path.resolve(process.env.NOVA_TOOLS || path.join(__dirname, '..', '..', '..', 'nova-tools'));

function findJava() {
  if (fs.existsSync(tools)) {
    const jdk = fs.readdirSync(tools).find((d) => /^jdk/i.test(d));
    if (jdk) {
      const exe = path.join(tools, jdk, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return 'java';
}

function run(args) {
  const r = spawnSync(findJava(), args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (r.error) throw new Error(`Could not start Java: ${r.error.message}`);
  return r;
}

function validateXml(file) {
  const out = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kosit-'));
  const r = run(['-jar', path.join(tools, 'kosit-validator.jar'),
    '-s', path.join(tools, 'xrechnung-config', 'scenarios.xml'),
    '-r', path.join(tools, 'xrechnung-config'), '-o', out, file]);
  const report = fs.readdirSync(out).find((f) => f.endsWith('-report.xml'));
  const text = report ? fs.readFileSync(path.join(out, report), 'utf8') : '';
  const acceptable = /<rep:assessment>\s*<rep:accept/.test(text) || r.status === 0;
  const errors = [...text.matchAll(/<rep:message[^>]*level="error"[^>]*>([\s\S]*?)<\/rep:message>/g)].map((m) => m[1].trim());
  return { ok: acceptable && !errors.length, errors, raw: acceptable ? '' : (r.stdout + r.stderr).slice(-2000) };
}

function validatePdf(file) {
  const r = run(['-jar', path.join(tools, 'mustang-cli.jar'), '--action', 'validate', '--source', file, '--no-notices']);
  const text = r.stdout + r.stderr;
  const ok = /<summary status="valid"\/>/.test(text) || /status="valid"/.test(text.split('<summary').pop() || '');
  const errors = [...text.matchAll(/<error[^>]*>([\s\S]*?)<\/error>/g)].map((m) => m[1].trim());
  return { ok: ok && !errors.length, errors, raw: ok ? '' : text.slice(-3000) };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.log('Usage: node scripts/validate-einvoices.js <file.xml|file.pdf> ...');
  process.exit(2);
}
let failed = 0;
for (const f of files) {
  const res = f.toLowerCase().endsWith('.pdf') ? validatePdf(f) : validateXml(f);
  console.log(`${res.ok ? 'VALID  ' : 'INVALID'} ${path.basename(f)}`);
  for (const e of res.errors) console.log(`   - ${e}`);
  if (!res.ok && !res.errors.length && res.raw) console.log(res.raw);
  if (!res.ok) failed += 1;
}
process.exit(failed ? 1 : 0);
