import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../contexts/AuthContext';
import { apiError } from '../../lib/format';
import { PageHeader } from './components';
import { EDIT_ROLES, hasAnyRole } from '../../lib/roles';

import { useVat } from '../../lib/useVat';

const inputCls = 'h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent';
const EMPTY = { customer_number: '', name: '', name2: '', street: '', postal_code: '', city: '', country: '', language: '', vat_id: '', email: '', invoice_email: '', phone: '', contact_person: '', payment_terms_days: '', skonto_days: '', skonto_percent: '', leitweg_id: '', notes: '' };

function CustomerModal({ initial, onClose, onSaved }) {
  const { t } = useTranslation();
  const { country: sellerCountry } = useVat();
  const [form, setForm] = useState({ ...EMPTY, ...Object.fromEntries(Object.entries(initial || {}).map(([k, v]) => [k, v ?? ''])) });
  const [vat, setVat] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const checkVat = async () => {
    setVat({ text: '…' });
    try {
      const r = await api.get(`/suppliers/validate-vat/${encodeURIComponent(form.vat_id)}`);
      setVat({ ok: r.data.isValid, text: r.data.isValid ? `✓ ${r.data.name || 'VIES'}` : '✗ VIES' });
      if (r.data.isValid) {
        setForm((f) => ({ ...f, vat_id: r.data.vat_number, name: f.name || r.data.name || '' }));
      }
    } catch (err) { setVat({ ok: false, text: apiError(err, 'VIES') }); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, country: (form.country || sellerCountry).toUpperCase() };
      delete body.id; delete body.created_at; delete body.open_amount; delete body.open_invoices; delete body.company_id;
      if (initial?.id) await api.put(`/customers/${initial.id}`, body); else await api.post('/customers', body);
      toast.success(t('sales.messages.saved'));
      onSaved();
    } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); } finally { setSaving(false); }
  };

  const F = ({ k, label, type = 'text', className = '' }) => (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input type={type} className={inputCls} value={form[k]} onChange={set(k)} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <Card className="max-h-[90vh] w-full max-w-3xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-xl font-semibold">{initial?.id ? t('sales.customers.edit') : t('sales.customers.new')}</h3>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-6">
          {F({ k: 'customer_number', label: t('sales.customers.number_auto'), className: 'sm:col-span-2' })}
          <label className="block space-y-1 sm:col-span-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sales.customers.name')} *</span>
            <input required className={inputCls} value={form.name} onChange={set('name')} />
          </label>
          {F({ k: 'name2', label: t('sales.customers.name2'), className: 'sm:col-span-6' })}
          {F({ k: 'street', label: t('sales.customers.street'), className: 'sm:col-span-6' })}
          {F({ k: 'postal_code', label: t('sales.customers.postal_code'), className: 'sm:col-span-1' })}
          {F({ k: 'city', label: t('sales.customers.city'), className: 'sm:col-span-3' })}
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sales.customers.country')}</span>
            <input maxLength={2} className={`${inputCls} uppercase`} placeholder={sellerCountry} value={form.country} onChange={set('country')} />
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sales.customers.language')}</span>
            <select className={inputCls} value={form.language} onChange={set('language')}>
              <option value="">{t('sales.customers.language_auto')}</option>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="block space-y-1 sm:col-span-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sales.customers.vat_id')}</span>
            <div className="flex gap-2">
              <input className={inputCls} placeholder="ATU12345678 / GB123456789" value={form.vat_id} onChange={(e) => { set('vat_id')(e); setVat(null); }} />
              <Button type="button" size="sm" variant="secondary" disabled={!form.vat_id} onClick={checkVat}>VIES</Button>
            </div>
            {vat && <span className={`text-xs ${vat.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{vat.text}</span>}
          </label>
          {F({ k: 'leitweg_id', label: t('sales.customers.leitweg_id'), className: 'sm:col-span-2' })}
          {F({ k: 'email', label: t('sales.customers.email'), type: 'email', className: 'sm:col-span-3' })}
          {F({ k: 'invoice_email', label: t('sales.customers.invoice_email'), type: 'email', className: 'sm:col-span-3' })}
          {F({ k: 'phone', label: t('sales.customers.phone'), className: 'sm:col-span-3' })}
          {F({ k: 'contact_person', label: t('sales.customers.contact'), className: 'sm:col-span-3' })}
          {F({ k: 'payment_terms_days', label: t('sales.fields.payment_terms'), type: 'number', className: 'sm:col-span-2' })}
          {F({ k: 'skonto_days', label: t('sales.fields.skonto_days'), type: 'number', className: 'sm:col-span-2' })}
          {F({ k: 'skonto_percent', label: t('sales.fields.skonto_percent'), type: 'number', className: 'sm:col-span-2' })}
          <label className="block space-y-1 sm:col-span-6">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('sales.customers.notes')}</span>
            <textarea rows={2} className={`${inputCls} h-auto py-2`} value={form.notes} onChange={set('notes')} />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-6">
            <input type="checkbox" checked={!!form.requires_certificates} onChange={(e) => setForm({ ...form, requires_certificates: e.target.checked ? 1 : 0 })} />
            {t('files.requires_certificates')}
          </label>
          <div className="flex justify-end gap-2 sm:col-span-6">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>✕</Button>
            <Button type="submit" size="sm" disabled={saving}>{t('sales.actions.save_plain')}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function CustomersPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [params] = useSearchParams();
  const [search, setSearch] = useState(() => params.get('search') || '');
  const [editing, setEditing] = useState(null);
  const canEdit = hasAnyRole(user, EDIT_ROLES);

  const load = useCallback(async () => {
    try { setCustomers((await api.get(`/customers?search=${encodeURIComponent(search)}`)).data); } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); }
  }, [search, t]);
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [load]);

  return (
    <div>
      <PageHeader title={t('sales.customers.title')}>
        {canEdit && <Button size="sm" onClick={() => setEditing({})}><Plus size={14} className="mr-1" />{t('sales.customers.new')}</Button>}
      </PageHeader>
      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-10 pl-9" placeholder={t('sales.fields.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="table-container overflow-x-auto">
        <table>
          <thead><tr><th>Nr.</th><th>{t('sales.customers.name')}</th><th>{t('sales.customers.city')}</th><th>{t('sales.customers.vat_id')}</th><th>{t('sales.fields.tax_treatment')}</th><th /></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className={c.active ? '' : 'opacity-50'}>
                <td className="font-mono text-sm">{c.customer_number}</td>
                <td>{c.name}</td>
                <td>{[c.postal_code, c.city].filter(Boolean).join(' ')}{c.country !== 'DE' ? ` (${c.country})` : ''}</td>
                <td className="font-mono text-sm">{c.vat_id || '—'}</td>
                <td className="text-sm">{t(`sales.treatment.${c.tax_treatment}`)}</td>
                <td className="text-right">{canEdit && <Button size="sm" variant="ghost" aria-label={t('sales.customers.edit')} onClick={() => setEditing(c)}><Pencil size={14} /></Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <CustomerModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
