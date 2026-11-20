import api from '../api/axios';

const locale = () => (document.documentElement.lang || navigator.language || 'de-DE');

// Money and number format follow the company's settings (companies.currency / locale); default EUR, de-DE.
let money = { currency: 'EUR', locale: 'de-DE' };
export function setMoneyFormat(currency, loc) {
  money = { currency: currency || 'EUR', locale: loc || 'de-DE' };
}
export const eur = (v) => new Intl.NumberFormat(money.locale, { style: 'currency', currency: money.currency }).format(Number(v || 0));
export const num = (v, max = 3) => new Intl.NumberFormat(money.locale, { maximumFractionDigits: max }).format(Number(v || 0));
// Dates as the company writes them: 21.11.2026 (de) or 21/11/2026 (en-GB).
export const dateDE = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join(money.locale.startsWith('de') ? '.' : '/') : '');
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export { locale };

/**
 * Shows the negative-stock warnings the server returns when the company's
 * rule is "warn" (booking went through, but stock is now below zero).
 */
export function showStockWarnings(warnings, t, toast) {
  if (!warnings?.length) return;
  const lines = warnings.map((w) => t('ops.stock_warning.line', {
    code: w.item_code || '', name: w.name || '', available: num(w.available), required: num(w.required), uom: w.uom || '',
  }));
  toast([t('ops.stock_warning.title'), ...lines].join('\n'), { icon: '⚠️', duration: 10000, style: { whiteSpace: 'pre-line' } });
}

/** Server error message for toasts. */
export const apiError = (err, fallback) => err?.response?.data?.error || fallback;

/** Opens a PDF/file from the API in a new tab (with the login token). */
export async function openFile(url) {
  const win = window.open('', '_blank');
  try {
    const res = await api.get(url, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(res.data);
    if (win) win.location.href = blobUrl; else window.location.href = blobUrl;
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}

/** Downloads a file from the API with its server-side file name. */
export async function downloadFile(url, fallbackName = 'download') {
  const res = await api.get(url, { responseType: 'blob' });
  const cd = res.headers['content-disposition'] || '';
  const name = (cd.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
  const blobUrl = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}
