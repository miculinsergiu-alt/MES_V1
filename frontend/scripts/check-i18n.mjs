// Reports translation keys used in the code that are missing in a language.
// Usage: node scripts/check-i18n.mjs   (exit code 1 if German or English keys are missing)
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(import.meta.dirname, '..', 'src');
const read = (f) => JSON.parse(fs.readFileSync(path.join(src, 'locales', f), 'utf8'));

const bundles = {
  de: { ...read('de.json'), sales: read('sales.de.json'), shell: read('shell.de.json'), onboarding: read('onboarding.de.json'), screens: read('screens.de.json') },
  en: { ...read('en.json'), sales: read('sales.en.json'), shell: read('shell.en.json'), onboarding: read('onboarding.en.json'), screens: read('screens.en.json') },
};

const lookup = (obj, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
// Plural keys (t('x', { count })) are stored as x_one / x_other.
const has = (obj, key) => lookup(obj, key) !== undefined || lookup(obj, `${key}_other`) !== undefined;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(jsx?|tsx?)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

const used = new Map();
for (const f of files(src)) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/\bt\(\s*'([a-z0-9_.]+)'/gi)) {
    if (!m[1].includes('.')) continue;
    if (!used.has(m[1])) used.set(m[1], path.relative(src, f));
  }
}

let missingCount = 0;
for (const [lang, bundle] of Object.entries(bundles)) {
  const missing = [...used].filter(([k]) => !has(bundle, k));
  missingCount += missing.length;
  console.log(`${lang}: ${used.size - missing.length}/${used.size} keys present`);
  for (const [k, f] of missing) console.log(`  missing ${k}  (${f})`);
}
process.exitCode = missingCount ? 1 : 0;
