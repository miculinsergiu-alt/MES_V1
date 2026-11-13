/**
 * Exact money arithmetic for invoices (no floating point errors).
 *
 * Amounts are handled as integer cents (BigInt). Rounding is "half away from
 * zero" (kaufmännisches Runden), and VAT is calculated the way the European
 * e-invoice standard EN 16931 requires: per VAT category and rate, on the sum
 * of the line net amounts — so the totals always match the e-invoice XML.
 *
 * Precision of inputs: quantity 3 decimals, unit price 4 decimals,
 * discount / VAT rate 2 decimals.
 */

/** Parses a number/decimal string into a BigInt scaled by 10^decimals. */
function scaled(value, decimals) {
  if (value === null || value === undefined || value === '') return 0n;
  const str = typeof value === 'number' ? value.toFixed(decimals) : String(value).trim();
  const m = str.match(/^(-)?(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`Invalid decimal value: ${value}`);
  const frac = (m[3] || '').padEnd(decimals, '0');
  // Round extra digits half away from zero.
  let int = BigInt(m[2] + frac.slice(0, decimals));
  if (frac.length > decimals && Number(frac[decimals]) >= 5) int += 1n;
  return m[1] ? -int : int;
}

/** Integer division rounding half away from zero. */
function divRound(numerator, denominator) {
  const neg = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (2n * d);
  return neg ? -q : q;
}

const toCents = (value) => scaled(value, 2);
const fromCents = (cents) => Number(cents) / 100;

/** Net amount of a line in cents: round(quantity × unit price × (1 − discount%)). */
function lineNetCents(quantity, unitPrice, discountPercent = 0) {
  const q = scaled(quantity, 3); // ×1e3
  const p = scaled(unitPrice, 4); // ×1e4
  const keep = 10000n - scaled(discountPercent, 2); // ×1e4 (100% = 10000)
  return divRound(q * p * keep, 10n ** 9n); // 1e3·1e4·1e4 = 1e11 → cents (1e2)
}

/** VAT in cents for a net base in cents at a percentage rate. */
function taxCents(baseCents, ratePercent) {
  return divRound(baseCents * scaled(ratePercent, 2), 10000n);
}

/**
 * Totals of a document.
 * lines: [{ quantity, unit_price, discount_percent, tax_rate, tax_category }]
 * Returns numbers in EUR (2 decimals) plus per-line net amounts and the VAT breakdown.
 */
function computeTotals(lines) {
  const lineNets = lines.map((l) => lineNetCents(l.quantity, l.unit_price, l.discount_percent || 0));
  const groups = new Map();
  lines.forEach((l, i) => {
    const key = `${l.tax_category}|${Number(l.tax_rate).toFixed(2)}`;
    const g = groups.get(key) || { tax_category: l.tax_category, tax_rate: Number(l.tax_rate), base: 0n };
    g.base += lineNets[i];
    groups.set(key, g);
  });
  let net = 0n; let tax = 0n;
  const breakdown = [...groups.values()]
    .sort((a, b) => b.tax_rate - a.tax_rate)
    .map((g) => {
      const t = taxCents(g.base, g.tax_rate);
      net += g.base; tax += t;
      return { tax_category: g.tax_category, tax_rate: g.tax_rate, net_amount: fromCents(g.base), tax_amount: fromCents(t) };
    });
  return {
    line_nets: lineNets.map(fromCents),
    breakdown,
    net_total: fromCents(net),
    tax_total: fromCents(tax),
    gross_total: fromCents(net + tax),
  };
}

/** Sum of amounts given in EUR, exactly. */
function sumAmounts(values) {
  return fromCents(values.reduce((s, v) => s + toCents(v), 0n));
}

/** Percentage of an amount (e.g. early-payment discount), rounded to cents. */
function percentOf(amount, percent) {
  return fromCents(divRound(toCents(amount) * scaled(percent, 2), 10000n));
}

/** German number formatting: 1234.5 -> "1.234,50". */
function formatEUR(value, { symbol = true } = {}) {
  const s = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return symbol ? `${s} €` : s;
}

module.exports = { scaled, divRound, toCents, fromCents, lineNetCents, taxCents, computeTotals, sumAmounts, percentOf, formatEUR };
