import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { apiError, setMoneyFormat } from '../../lib/format';
import { useVat, clearVatCache, countryName } from '../../lib/useVat';
import { PageHeader } from './components';

const inputCls = 'h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent';
const FIELDS = ['name', 'legal_name', 'street', 'postal_code', 'city', 'country', 'vat_id', 'tax_number', 'register_court', 'register_number',
  'managing_directors', 'email', 'phone', 'website', 'bank_name', 'iban', 'bic', 'logo_data_url', 'default_payment_terms_days',
  'default_skonto_days', 'default_skonto_percent', 'small_business', 'invoice_footer_text', 'datev_consultant_number',
  'datev_client_number', 'datev_chart', 'dunning_fee', 'dunning_grace_days', 'negative_stock', 'labor_rate', 'calc_material_surcharge', 'calc_overhead', 'calc_margin', 'currency'];

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { countries } = useVat();
  const [form, setForm] = useState(null);
  const [missing, setMissing] = useState([]);
  const [series, setSeries] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadSeries = () => api.get('/settings/number-series').then((r) => setSeries(r.data)).catch(() => {});
  useEffect(() => {
    api.get('/settings/company').then((r) => {
      setForm(Object.fromEntries(FIELDS.map((f) => [f, r.data[f] ?? ''])));
      setMissing(r.data.missing_for_invoices || []);
    }).catch((err) => toast.error(apiError(err, t('sales.messages.error'))));
    loadSeries();
  }, [t]);

  if (!form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value }));

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 300 * 1024) { toast.error('Max. 300 KB'); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logo_data_url: reader.result }));
    reader.readAsDataURL(file);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put('/settings/company', form);
      setMissing(res.data.missing_for_invoices || []);
      // A new country can bring a new currency: show it and use it everywhere.
      setForm((f) => ({ ...f, country: res.data.country, currency: res.data.currency }));
      setMoneyFormat(res.data.currency, res.data.locale);
      clearVatCache();
      toast.success(t('sales.settings.saved'));
    } catch (err) { toast.error(apiError(err, t('sales.messages.error')), { duration: 8000 }); } finally { setSaving(false); }
  };

  const saveSeries = async (s) => {
    try {
      await api.put(`/settings/number-series/${s.doc_type}`, { prefix: s.prefix, next_number: Number(s.next_number) });
      toast.success(t('sales.messages.saved'));
      loadSeries();
    } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); loadSeries(); }
  };

  const F = (k, label, props = {}) => (
    <label className={`block space-y-1 ${props.wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input className={inputCls} value={form[k]} onChange={set(k)} type={props.type || 'text'} />
    </label>
  );
  const Section = ({ title, children }) => (
    <Card className="space-y-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </Card>
  );

  return (
    <form onSubmit={save} className="max-w-4xl space-y-6">
      <PageHeader title={t('sales.settings.title')}>
        <Button type="submit" size="sm" disabled={saving}>{t('sales.actions.save_plain')}</Button>
      </PageHeader>
      {missing.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{t('sales.settings.missing', { fields: missing.join(', ') })}</div>
      )}

      {Section({ title: t('sales.settings.company'), children: <>
        {F('name', 'Name')}{F('legal_name', t('sales.settings.legal_name'))}
        {F('street', t('sales.customers.street'), { wide: true })}
        {F('postal_code', t('sales.customers.postal_code'))}{F('city', t('sales.customers.city'))}
        {F('email', t('sales.customers.email'), { type: 'email' })}{F('phone', t('sales.customers.phone'))}
        {F('website', t('sales.settings.website'))}
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sales.settings.logo')}</span>
          <input type="file" accept="image/png,image/jpeg" onChange={onLogo} className="text-sm" />
          {form.logo_data_url && (
            <div className="flex items-center gap-3 pt-1">
              <img src={form.logo_data_url} alt="Logo" className="h-10 max-w-[160px] object-contain" />
              <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => setForm((f) => ({ ...f, logo_data_url: '' }))}>{t('sales.settings.remove_logo')}</button>
            </div>
          )}
        </label>
      </> })}

      {Section({ title: t('sales.settings.tax'), children: <>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sales.settings.seller_country')}</span>
          <select className={inputCls} value={form.country || 'DE'} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value, currency: countries[e.target.value]?.currency || f.currency }))}>
            {Object.keys(countries).sort((a, b) => countryName(a, i18n.language).localeCompare(countryName(b, i18n.language))).map((code) => (
              <option key={code} value={code}>{countryName(code, i18n.language)} ({code})</option>
            ))}
          </select>
          <span className="block text-xs text-muted-foreground">{t('sales.settings.seller_country_hint', { rates: (countries[form.country]?.rates || []).join(' / ') })}</span>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sales.settings.currency')}</span>
          <select className={inputCls} value={form.currency || 'EUR'} onChange={set('currency')}>
            {[...new Set(Object.values(countries).map((c) => c.currency))].sort().map((cur) => <option key={cur} value={cur}>{cur}</option>)}
          </select>
        </label>
        {F('vat_id', t('sales.customers.vat_id'))}{F('tax_number', t('sales.settings.tax_number'))}
        {F('register_court', t('sales.settings.register_court'))}{F('register_number', t('sales.settings.register_number'))}
        {F('managing_directors', t('sales.settings.managing_directors'), { wide: true })}
      </> })}

      {Section({ title: t('sales.settings.bank'), children: <>
        {F('bank_name', t('sales.settings.bank_name'), { wide: true })}{F('iban', t('sales.settings.iban'))}{F('bic', t('sales.settings.bic'))}
      </> })}

      {Section({ title: t('sales.settings.invoicing'), children: <>
        {F('default_payment_terms_days', t('sales.settings.default_payment_terms'), { type: 'number' })}
        <div className="grid grid-cols-2 gap-2">{F('default_skonto_days', t('sales.fields.skonto_days'), { type: 'number' })}{F('default_skonto_percent', t('sales.fields.skonto_percent'), { type: 'number' })}</div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={!!Number(form.small_business)} onChange={set('small_business')} />{t('sales.settings.small_business')}</label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sales.settings.footer_text')}</span>
          <textarea rows={2} className={`${inputCls} h-auto py-2`} value={form.invoice_footer_text} onChange={set('invoice_footer_text')} />
        </label>
      </> })}

      {Section({ title: t('sales.settings.dunning'), children: <>
        {F('dunning_fee', t('sales.settings.dunning_fee'), { type: 'number' })}{F('dunning_grace_days', t('sales.settings.grace_days'), { type: 'number' })}
      </> })}

      {Section({ title: t('ops.settings.stock_costing'), children: <>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('ops.settings.negative_stock')}</span>
          <select className={inputCls} value={form.negative_stock} onChange={set('negative_stock')}>
            <option value="allow">{t('ops.settings.negative_allow')}</option>
            <option value="warn">{t('ops.settings.negative_warn')}</option>
            <option value="block">{t('ops.settings.negative_block')}</option>
          </select>
        </label>
        {F('labor_rate', t('ops.settings.labor_rate'), { type: 'number' })}
        <p className="pt-2 text-sm font-semibold sm:col-span-2">{t('calc.settings_title')}</p>
        {F('calc_material_surcharge', `${t('calc.rate.material_surcharge')} %`, { type: 'number' })}{F('calc_overhead', `${t('calc.rate.overhead')} %`, { type: 'number' })}{F('calc_margin', `${t('calc.rate.margin')} %`, { type: 'number' })}
        <p className="text-xs text-muted-foreground sm:col-span-2">{t('ops.settings.costing_hint')}</p>
      </> })}

      {Section({ title: t('sales.settings.datev'), children: <>
        {F('datev_consultant_number', t('sales.settings.consultant'), { type: 'number' })}{F('datev_client_number', t('sales.settings.client'), { type: 'number' })}
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sales.settings.chart')}</span>
          <select className={inputCls} value={form.datev_chart} onChange={set('datev_chart')}><option>SKR03</option><option>SKR04</option></select>
        </label>
      </> })}

      <Card className="space-y-3">
        <h2 className="font-semibold">{t('sales.settings.series')}</h2>
        <table>
          <thead><tr><th /><th>{t('sales.settings.series_prefix')}</th><th>{t('sales.settings.series_next')}</th><th /><th /></tr></thead>
          <tbody>
            {series.map((s, i) => (
              <tr key={s.doc_type}>
                <td className="text-sm">{s.doc_type === 'customer' ? t('sales.nav.customers') : s.doc_type === 'dunning' ? t('sales.nav.dunning') : t(`sales.types.${s.doc_type}`)}</td>
                <td><input className={`${inputCls} w-24`} value={s.prefix} onChange={(e) => setSeries((all) => all.map((x, j) => (j === i ? { ...x, prefix: e.target.value } : x)))} /></td>
                <td><input type="number" min={1} className={`${inputCls} w-28`} value={s.next_number} onChange={(e) => setSeries((all) => all.map((x, j) => (j === i ? { ...x, next_number: e.target.value } : x)))} /></td>
                <td className="font-mono text-sm text-muted-foreground">{s.next_preview}</td>
                <td><Button type="button" size="sm" variant="ghost" onClick={() => saveSeries(s)}>✓</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </form>
  );
}
