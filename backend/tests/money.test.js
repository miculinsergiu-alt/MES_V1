const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../lib/money');

test('no floating point errors', () => {
  // 0.1 + 0.2 style problems: 3 × 0.10 € = 0.30 €
  assert.equal(m.fromCents(m.lineNetCents(3, 0.1)), 0.3);
  assert.equal(m.sumAmounts([0.1, 0.2]), 0.3);
});

test('line net: quantity × price × (1 − discount), rounded half away from zero', () => {
  assert.equal(m.fromCents(m.lineNetCents('2.5', '19.99')), 49.98); // 49.975 -> 49.98
  assert.equal(m.fromCents(m.lineNetCents(1, '0.0049')), 0); // 0.0049 -> 0.00
  assert.equal(m.fromCents(m.lineNetCents(1, '0.005')), 0.01);
  assert.equal(m.fromCents(m.lineNetCents(10, 100, 15)), 850);
  assert.equal(m.fromCents(m.lineNetCents('1.333', '3.3333', '2.5')), 4.33); // 4.33221...
});

test('VAT per rate on the sum of lines (EN 16931), not per line', () => {
  // Three lines of 0.05 € at 19 %: per line 0.0095 -> 0.01 each = 0.03,
  // but correct is 19 % of 0.15 = 0.0285 -> 0.03. Use 0.03 € lines to see a difference:
  // per line 0.0057 -> 0.01 (×3 = 0.03); on the sum 0.09 × 19 % = 0.0171 -> 0.02.
  const t = m.computeTotals([1, 2, 3].map(() => ({ quantity: 1, unit_price: 0.03, tax_rate: 19, tax_category: 'S' })));
  assert.equal(t.net_total, 0.09);
  assert.equal(t.tax_total, 0.02);
  assert.equal(t.gross_total, 0.11);
});

test('mixed rates are broken down per rate', () => {
  const t = m.computeTotals([
    { quantity: 2, unit_price: 100, tax_rate: 19, tax_category: 'S' },
    { quantity: 1, unit_price: 50, tax_rate: 7, tax_category: 'S' },
    { quantity: 1, unit_price: 10, tax_rate: 19, tax_category: 'S', discount_percent: 10 },
  ]);
  assert.deepEqual(t.breakdown, [
    { tax_category: 'S', tax_rate: 19, net_amount: 209, tax_amount: 39.71 },
    { tax_category: 'S', tax_rate: 7, net_amount: 50, tax_amount: 3.5 },
  ]);
  assert.equal(t.gross_total, 302.21);
});

test('negative amounts round symmetrically', () => {
  assert.equal(m.fromCents(m.divRound(-5n, 10n)), -0.01);
  assert.equal(m.fromCents(m.lineNetCents(-1, '0.005')), -0.01);
});

test('large amounts stay exact', () => {
  assert.equal(m.fromCents(m.lineNetCents(99999.999, '99999.9999')), 9999999890); // 1e10 - 10 - 100 + 1e-7
});

test('German formatting', () => {
  assert.equal(m.formatEUR(1234.5), '1.234,50 €');
  assert.equal(m.percentOf(1000, 2), 20);
});
