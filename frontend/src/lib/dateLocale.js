import { de, ro, enUS } from 'date-fns/locale';

/** date-fns locale for the current UI language (German by default). */
export function dateLocaleFor(language) {
  const lang = String(language || 'de').slice(0, 2);
  if (lang === 'ro') return ro;
  if (lang === 'en') return enUS;
  return de;
}
