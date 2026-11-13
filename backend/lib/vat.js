/**
 * VAT helpers: EU VAT IDs and German tax treatment of a sale.
 */

// EU member states as used by VIES (Greece is 'EL'; 'XI' = Northern Ireland).
const VIES_COUNTRIES = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);

// ISO country codes of the EU (Greece is 'GR' in ISO, 'EL' in VAT ids).
const EU_COUNTRIES = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'GR', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);

/** Normalises a VAT id: 'de 123 456 789' -> { country: 'DE', number: '123456789' }; null if invalid. */
function parseVatId(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let country = clean.slice(0, 2);
  const number = clean.slice(2);
  if (country === 'GR') country = 'EL';
  if (!VIES_COUNTRIES.has(country) || !/^[A-Z0-9]{2,12}$/.test(number)) return null;
  return { country, number };
}

function normalizeVatId(raw) {
  const p = parseVatId(raw);
  return p ? p.country + p.number : null;
}

/**
 * Default tax treatment of a customer seen from a German seller:
 *  - Germany: domestic VAT
 *  - other EU country with VAT id: tax-free intra-Community supply
 *  - other EU country without VAT id (consumer): German VAT
 *  - outside the EU: tax-free export
 */
function defaultTaxTreatment(country, vatId) {
  const c = String(country || 'DE').toUpperCase();
  if (c === 'DE') return 'domestic';
  if (EU_COUNTRIES.has(c)) return vatId ? 'intra_eu' : 'domestic';
  return 'export';
}

/**
 * Per-line VAT category (EN 16931 codes) and rate for a tax treatment.
 * S = standard/reduced rate, K = intra-Community supply, G = export, E = exempt.
 */
function lineTax(treatment, itemRate) {
  switch (treatment) {
    case 'intra_eu': return { tax_category: 'K', tax_rate: 0 };
    case 'export': return { tax_category: 'G', tax_rate: 0 };
    case 'small_business': return { tax_category: 'E', tax_rate: 0 };
    default: return { tax_category: 'S', tax_rate: Number(itemRate) === 7 ? 7 : 19 };
  }
}

/** Legally required note on the invoice for tax-free sales. */
const TAX_NOTES = {
  intra_eu: 'Steuerfreie innergemeinschaftliche Lieferung gemäß § 4 Nr. 1b i. V. m. § 6a UStG.',
  export: 'Steuerfreie Ausfuhrlieferung gemäß § 4 Nr. 1a i. V. m. § 6 UStG.',
  small_business: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
};

/** Exemption reason codes for e-invoices (VATEX code list). */
const VATEX = {
  K: { code: 'VATEX-EU-IC', text: 'Intra-Community supply' },
  G: { code: 'VATEX-EU-G', text: 'Export outside the EU' },
  E: { code: 'VATEX-EU-O', text: 'Kleinunternehmer gemäß § 19 UStG' },
};

module.exports = { VIES_COUNTRIES, EU_COUNTRIES, parseVatId, normalizeVatId, defaultTaxTreatment, lineTax, TAX_NOTES, VATEX };
