/**
 * VAT helpers: VAT ids, VAT rates per country and the tax treatment of a sale
 * seen from the seller's country (EU member states and the United Kingdom).
 */

// EU member states as used by VIES (Greece is 'EL'; 'XI' = Northern Ireland).
const VIES_COUNTRIES = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI']);

// ISO country codes of the EU (Greece is 'GR' in ISO, 'EL' in VAT ids).
const EU_COUNTRIES = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'GR', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);

/**
 * Seller countries NOVA can invoice from: VAT rates (standard first, then reduced),
 * currency and default document language. Rates as of November 2026 — they change,
 * so the customer must check them; any rate from 0 to 30 % is accepted on items.
 */
const COUNTRY_VAT = {
  AT: { rates: [20, 13, 10], currency: 'EUR', lang: 'de' },
  BE: { rates: [21, 12, 6], currency: 'EUR', lang: 'en' },
  BG: { rates: [20, 9], currency: 'EUR', lang: 'en' },
  CY: { rates: [19, 9, 5, 3], currency: 'EUR', lang: 'en' },
  CZ: { rates: [21, 12], currency: 'CZK', lang: 'en' },
  DE: { rates: [19, 7], currency: 'EUR', lang: 'de' },
  DK: { rates: [25], currency: 'DKK', lang: 'en' },
  EE: { rates: [24, 13, 9], currency: 'EUR', lang: 'en' },
  ES: { rates: [21, 10, 4], currency: 'EUR', lang: 'en' },
  FI: { rates: [25.5, 13.5, 10], currency: 'EUR', lang: 'en' },
  FR: { rates: [20, 10, 5.5, 2.1], currency: 'EUR', lang: 'en' },
  GR: { rates: [24, 13, 6], currency: 'EUR', lang: 'en' },
  HR: { rates: [25, 13, 5], currency: 'EUR', lang: 'en' },
  HU: { rates: [27, 18, 5], currency: 'HUF', lang: 'en' },
  IE: { rates: [23, 13.5, 9, 4.8], currency: 'EUR', lang: 'en' },
  IT: { rates: [22, 10, 5, 4], currency: 'EUR', lang: 'en' },
  LT: { rates: [21, 12, 5], currency: 'EUR', lang: 'en' },
  LU: { rates: [17, 14, 8, 3], currency: 'EUR', lang: 'en' },
  LV: { rates: [21, 12, 5], currency: 'EUR', lang: 'en' },
  MT: { rates: [18, 7, 5], currency: 'EUR', lang: 'en' },
  NL: { rates: [21, 9], currency: 'EUR', lang: 'en' },
  PL: { rates: [23, 8, 5], currency: 'PLN', lang: 'en' },
  PT: { rates: [23, 13, 6], currency: 'EUR', lang: 'en' },
  RO: { rates: [21, 11], currency: 'RON', lang: 'en' },
  SE: { rates: [25, 12, 6], currency: 'SEK', lang: 'en' },
  SI: { rates: [22, 9.5, 5], currency: 'EUR', lang: 'en' },
  SK: { rates: [23, 19, 5], currency: 'EUR', lang: 'en' },
  GB: { rates: [20, 5], currency: 'GBP', lang: 'en' },
};
const SELLER_COUNTRIES = Object.keys(COUNTRY_VAT);
const CURRENCIES = [...new Set(Object.values(COUNTRY_VAT).map((c) => c.currency))];
const GERMAN_SPEAKING = new Set(['DE', 'AT', 'CH', 'LI']);

const MAX_RATE = 30;
/** A VAT rate that may be stored on an item or a document line. */
const isValidRate = (x) => Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= MAX_RATE && Math.round(Number(x) * 100) === Number(x) * 100;

const vatInfo = (country) => COUNTRY_VAT[String(country || 'DE').toUpperCase()] || COUNTRY_VAT.DE;
const standardRate = (country) => vatInfo(country).rates[0];
/** Default document language for a customer in this country. */
const languageFor = (country) => (GERMAN_SPEAKING.has(String(country || 'DE').toUpperCase()) ? 'de' : 'en');

/**
 * Normalises a VAT id: 'de 123 456 789' -> { country: 'DE', number: '123456789' }; null if invalid.
 * EU (VIES) ids plus UK ids: GB + 9 or 12 digits, or GBGD / GBHA + 3 digits.
 */
function parseVatId(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let country = clean.slice(0, 2);
  const number = clean.slice(2);
  if (country === 'GR') country = 'EL';
  if (country === 'GB') return /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/.test(number) ? { country, number } : null;
  if (!VIES_COUNTRIES.has(country) || !/^[A-Z0-9]{2,12}$/.test(number)) return null;
  return { country, number };
}

function normalizeVatId(raw) {
  const p = parseVatId(raw);
  return p ? p.country + p.number : null;
}

/**
 * Default tax treatment of a customer, seen from the seller's country:
 *  - same country: domestic VAT
 *  - EU seller, other EU country with VAT id: tax-free intra-Community supply
 *  - EU seller, other EU country without VAT id (consumer): seller's VAT (distance sales below the OSS threshold)
 *  - everything else (outside the seller's VAT area, e.g. EU <-> UK): tax-free / zero-rated export
 */
function defaultTaxTreatment(country, vatId, sellerCountry = 'DE') {
  const c = String(country || sellerCountry || 'DE').toUpperCase();
  const s = String(sellerCountry || 'DE').toUpperCase();
  if (c === s) return 'domestic';
  if (EU_COUNTRIES.has(s) && EU_COUNTRIES.has(c)) return vatId ? 'intra_eu' : 'domestic';
  return 'export';
}

/**
 * Per-line VAT category (EN 16931 codes) and rate for a tax treatment.
 * S = standard/reduced rate, Z = zero rated, K = intra-Community supply, G = export, E = exempt.
 */
function lineTax(treatment, itemRate, sellerCountry = 'DE') {
  switch (treatment) {
    case 'intra_eu': return { tax_category: 'K', tax_rate: 0 };
    case 'export': return { tax_category: 'G', tax_rate: 0 };
    case 'small_business': return { tax_category: 'E', tax_rate: 0 };
    default: {
      const rate = isValidRate(itemRate) ? Number(itemRate) : standardRate(sellerCountry);
      return rate === 0 ? { tax_category: 'Z', tax_rate: 0 } : { tax_category: 'S', tax_rate: rate };
    }
  }
}

/** Legally required notes on invoices of a German seller (German documents). */
const TAX_NOTES = {
  intra_eu: 'Steuerfreie innergemeinschaftliche Lieferung gemäß § 4 Nr. 1b i. V. m. § 6a UStG.',
  export: 'Steuerfreie Ausfuhrlieferung gemäß § 4 Nr. 1a i. V. m. § 6 UStG.',
  small_business: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
};

const NOTES = {
  DE: {
    de: TAX_NOTES,
    en: {
      intra_eu: 'Tax-free intra-Community supply according to § 4 No. 1b in conjunction with § 6a German VAT Act (UStG).',
      export: 'Tax-free export delivery according to § 4 No. 1a in conjunction with § 6 German VAT Act (UStG).',
      small_business: 'No VAT is charged according to § 19 German VAT Act (UStG, small business).',
    },
  },
  EU: {
    de: {
      intra_eu: 'Steuerfreie innergemeinschaftliche Lieferung (Art. 138 Richtlinie 2006/112/EG). Steuerschuldnerschaft des Leistungsempfängers.',
      export: 'Steuerfreie Ausfuhrlieferung (Art. 146 Richtlinie 2006/112/EG).',
      small_business: 'Kleinunternehmer – es wird keine Umsatzsteuer berechnet.',
    },
    en: {
      intra_eu: 'Exempt intra-Community supply of goods (Article 138, Council Directive 2006/112/EC). VAT to be accounted for by the customer.',
      export: 'Exempt export of goods outside the EU (Article 146, Council Directive 2006/112/EC).',
      small_business: 'Small business exemption – no VAT is charged.',
    },
  },
  GB: {
    de: {
      export: 'Ausfuhrlieferung aus dem Vereinigten Königreich zum Nullsteuersatz (VAT Act 1994, s. 30).',
      small_business: 'Nicht für die Umsatzsteuer (VAT) registriert – es wird keine VAT berechnet.',
    },
    en: {
      export: 'Zero-rated export of goods (VAT Act 1994, section 30).',
      small_business: 'Not registered for VAT – no VAT is charged.',
    },
  },
};

/** The note a tax-free invoice must carry, in the document's language (or null). */
function taxNote(treatment, sellerCountry = 'DE', lang = 'de') {
  const s = String(sellerCountry || 'DE').toUpperCase();
  const set = NOTES[s === 'DE' || s === 'GB' ? s : 'EU'];
  return (set[lang] || set.en)[treatment] || null;
}

/** Exemption reason codes for e-invoices (VATEX code list). */
const VATEX = {
  K: { code: 'VATEX-EU-IC', text: 'Intra-Community supply' },
  G: { code: 'VATEX-EU-G', text: 'Export outside the EU' },
  E: { code: 'VATEX-EU-O', text: 'Kleinunternehmer gemäß § 19 UStG' },
};

module.exports = {
  VIES_COUNTRIES, EU_COUNTRIES, COUNTRY_VAT, SELLER_COUNTRIES, CURRENCIES, MAX_RATE,
  parseVatId, normalizeVatId, defaultTaxTreatment, lineTax, TAX_NOTES, taxNote, VATEX,
  isValidRate, standardRate, languageFor, vatInfo,
};
