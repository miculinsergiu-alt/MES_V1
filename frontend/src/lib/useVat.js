import { useEffect, useState } from 'react';
import api from '../api/axios';

// Seller country of the company and the VAT rates of all supported countries (EU + GB).
let cache = null;

/** Forget the cached data, e.g. after the company country was changed in the settings. */
export function clearVatCache() { cache = null; }

export function useVat() {
  const [data, setData] = useState(cache);
  useEffect(() => {
    if (cache) return;
    Promise.all([api.get('/settings/vat-countries'), api.get('/settings/company')])
      .then(([countries, company]) => {
        cache = { countries: countries.data, country: company.data.country || 'DE' };
        setData(cache);
      })
      .catch(() => { /* fall back to German rates */ });
  }, []);
  const country = data?.country || 'DE';
  const rates = data?.countries?.[country]?.rates || [19, 7];
  return { countries: data?.countries || {}, country, rates, standard: rates[0] };
}

/** Country name in the UI language, e.g. 'GB' -> 'United Kingdom'. */
export function countryName(code, lang) {
  try { return new Intl.DisplayNames([lang || 'en'], { type: 'region' }).of(code) || code; } catch { return code; }
}
