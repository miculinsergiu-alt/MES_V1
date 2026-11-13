import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, FileText, Save, Send, ShieldCheck, Download, ArrowRight, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../contexts/AuthContext';
import { eur, num, dateDE, todayISO, apiError, openFile, downloadFile } from '../../lib/format';
import { StatusPill } from './components';
import { EDIT_ROLES, ACCOUNTING_ROLES } from '../../lib/roles';

const HEADER_FIELDS = ['document_date', 'service_date', 'service_period_end', 'valid_until', 'delivery_date', 'payment_terms_days',
  'skonto_days', 'skonto_percent', 'customer_reference', 'buyer_reference', 'intro_text', 'closing_text', 'internal_notes'];

const emptyLine = () => ({ item_id: '', description: '', quantity: 1, unit: 'Stk', unit_price: 0, discount_percent: 0, tax_rate: 19 });

/** Preview of totals (the server recalculates exactly when saving). */
function previewTotals(lines, treatment) {
  const exempt = treatment && treatment !== 'domestic';
  const groups = {};
  let net = 0;
  for (const l of lines) {
    const lineNet = Math.round(Number(l.quantity || 0) * Number(l.unit_price || 0) * (1 - Number(l.discount_percent || 0) / 100) * 100) / 100;
    const rate = exempt ? 0 : Number(l.tax_rate || 0);
    groups[rate] = (groups[rate] || 0) + lineNet;
    net += lineNet;
  }
  const breakdown = Object.entries(groups).map(([rate, base]) => ({ rate: Number(rate), base, tax: Math.round(base * Number(rate)) / 100 }));
  const tax = breakdown.reduce((s, b) => s + b.tax, 0);
  return { net, tax, gross: net + tax, breakdown: breakdown.sort((a, b) => b.rate - a.rate) };
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-muted/40';

export default function DocumentEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();

  const [doc, setDoc] = useState(null);
  const [form, setForm] = useState(() => (isNew ? { document_date: todayISO() } : {}));
  const [lines, setLines] = useState(() => (isNew ? [emptyLine()] : []));
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState([]);
  const [items, setItems] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issueDialog, setIssueDialog] = useState(false);
  const [production, setProduction] = useState({ enabled: false, planned_start: `${todayISO()}T06:00` });
  const [payment, setPayment] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [integrity, setIntegrity] = useState(null);

  const docType = doc?.doc_type || params.get('type') || 'invoice';
  const locked = !!doc?.locked;
  const canEdit = EDIT_ROLES.includes(user?.role) && !locked;
  const canAccount = ACCOUNTING_ROLES.includes(user?.role);

  const applyDoc = useCallback((d) => {
    setDoc(d);
    setCustomerId(String(d.customer_id));
    setForm(Object.fromEntries(HEADER_FIELDS.map((f) => [f, d[f] ?? ''])));
    setLines(d.lines.map((l) => ({ ...l, item_id: l.item_id ?? '' })));
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const res = await api.get(`/sales/${id}`);
      applyDoc(res.data);
      if (res.data.doc_type === 'invoice' && res.data.locked) {
        api.get(`/sales/${id}/dunning`).then((r) => setReminders(r.data)).catch(() => {});
      }
    } catch (err) {
      toast.error(apiError(err, t('sales.messages.error')));
      navigate('/sales/documents');
    }
  }, [id, isNew, applyDoc, navigate, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/customers?active=1').then((r) => setCustomers(r.data)).catch(() => {});
    api.get('/items').then((r) => setItems(r.data)).catch(() => {});
  }, []);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const handler = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const customer = customers.find((c) => String(c.id) === String(customerId));
  const treatment = doc?.tax_treatment && !dirty ? doc.tax_treatment : (customer?.tax_treatment || doc?.tax_treatment || 'domestic');
  const totals = useMemo(() => previewTotals(lines, treatment), [lines, treatment]);
  const showPrices = docType !== 'delivery';

  const setField = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const setLine = (i, patch) => { setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); setDirty(true); };
  const pickItem = (i, itemId) => {
    const it = items.find((x) => String(x.id) === String(itemId));
    setLine(i, it
      ? { item_id: it.id, description: it.name, unit: it.uom || 'Stk', unit_price: it.unit_price || 0, tax_rate: Number(it.tax_rate ?? 19) }
      : { item_id: '' });
  };

  const payload = () => ({
    ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])),
    customer_id: Number(customerId),
    lines: lines.filter((l) => l.description || l.item_id).map((l) => ({
      item_id: l.item_id || null,
      source_line_id: l.source_line_id || null,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unit_price,
      discount_percent: l.discount_percent || 0,
      tax_rate: l.tax_rate,
    })),
  });

  const save = async () => {
    if (!customerId) { toast.error(t('sales.editor.pick_customer')); return null; }
    setBusy(true);
    try {
      const res = isNew
        ? await api.post('/sales', { doc_type: docType, ...payload() })
        : await api.put(`/sales/${id}`, payload());
      applyDoc(res.data);
      toast.success(t('sales.messages.saved'));
      if (isNew) navigate(`/sales/documents/${res.data.id}`, { replace: true });
      return res.data;
    } catch (err) {
      toast.error(apiError(err, t('sales.messages.error')));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    setBusy(true);
    try {
      let current = doc;
      if (dirty || isNew) current = await save();
      if (!current) return;
      const body = docType === 'order' && production.enabled ? { create_production: { planned_start: production.planned_start } } : {};
      const res = await api.post(`/sales/${current.id}/issue`, body);
      setIssueDialog(false);
      toast.success(t('sales.messages.issued', { number: res.data.number }));
      if (isNew) navigate(`/sales/documents/${res.data.id}`, { replace: true }); else load();
    } catch (err) {
      toast.error(apiError(err, t('sales.messages.error')), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t('sales.editor.delete_confirm'))) return;
    try {
      await api.delete(`/sales/${id}`);
      toast.success(t('sales.messages.deleted'));
      navigate('/sales/documents');
    } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); }
  };

  const convert = async (target) => {
    try {
      const res = await api.post(`/sales/${id}/convert`, { target });
      navigate(`/sales/documents/${res.data.id}`);
    } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); }
  };

  const setQuoteStatus = async (status) => {
    try { applyDoc((await api.post(`/sales/${id}/status`, { status })).data); } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); }
  };

  const recordPayment = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/sales/${id}/payments`, payment);
      toast.success(t('sales.messages.payment_saved'));
      setPayment(null);
      load();
    } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); }
  };

  const sendReminder = async () => {
    try {
      await api.post(`/sales/${id}/dunning`, { force: true });
      toast.success(t('sales.dunning.sent'));
      load();
    } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); }
  };

  const verify = async () => {
    try { setIntegrity((await api.get(`/sales/${id}/verify`)).data); } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); }
  };

  const preview = async () => {
    try {
      let current = doc;
      if (dirty || isNew) current = await save();
      if (current) await openFile(`/sales/${current.id}/pdf`);
    } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); }
  };

  const title = isNew
    ? t('sales.editor.new_title', { type: t(`sales.types.${docType}`) })
    : `${t(`sales.types.${docType}`)} ${doc?.number || ''}`;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to={`/sales/documents?type=${docType}`} className="text-sm text-muted-foreground hover:text-foreground">← {t(`sales.types_plural.${docType}`)}</Link>
          <h1 className="mt-1 font-display text-3xl">{title}</h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
            {doc && <StatusPill status={doc.status} t={t} />}
            <span>{locked ? t('sales.editor.locked_hint', { date: dateDE(doc.issued_at) }) : t('sales.editor.draft_hint')}</span>
            {dirty && <span className="font-semibold text-amber-600">● {t('sales.editor.unsaved')}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={preview} disabled={busy || (!customerId)}><FileText size={14} className="mr-1" />{locked ? t('sales.actions.pdf') : t('sales.actions.preview')}</Button>
          {canEdit && <Button size="sm" variant="secondary" onClick={save} disabled={busy}><Save size={14} className="mr-1" />{t('sales.actions.save')}</Button>}
          {canEdit && <Button size="sm" onClick={() => setIssueDialog(true)} disabled={busy || !customerId}><Send size={14} className="mr-1" />{t('sales.actions.issue')}</Button>}
          {canEdit && !isNew && <Button size="sm" variant="ghost" onClick={remove}><Trash2 size={14} /></Button>}
        </div>
      </div>

      {/* Customer & header data */}
      <Card className="mb-6 grid gap-4 md:grid-cols-3">
        <Field label={t('sales.fields.customer')} className="md:col-span-1">
          <select className={inputCls} value={customerId} disabled={!canEdit} onChange={(e) => { setCustomerId(e.target.value); setDirty(true); }}>
            <option value="">{t('sales.editor.pick_customer')}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.customer_number} · {c.name}</option>)}
          </select>
          {(customer || doc) && (
            <p className="whitespace-pre-line pt-1 text-xs text-muted-foreground">
              {locked ? doc.customer_address : [customer?.street, [customer?.postal_code, customer?.city].filter(Boolean).join(' '), customer?.country].filter(Boolean).join('\n')}
              {'\n'}{t(`sales.treatment.${treatment}`)}
            </p>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 md:col-span-2">
          <Field label={t('sales.fields.date')}><input type="date" className={inputCls} disabled={!canEdit} value={form.document_date || ''} onChange={(e) => setField('document_date', e.target.value)} /></Field>
          {['invoice', 'credit_note'].includes(docType) && (
            <Field label={t('sales.fields.service_date')}><input type="date" className={inputCls} disabled={!canEdit} value={form.service_date || ''} onChange={(e) => setField('service_date', e.target.value)} /></Field>
          )}
          {docType === 'quote' && (
            <Field label={t('sales.fields.valid_until')}><input type="date" className={inputCls} disabled={!canEdit} value={form.valid_until || ''} onChange={(e) => setField('valid_until', e.target.value)} /></Field>
          )}
          {docType === 'order' && (
            <Field label={t('sales.fields.delivery_date')}><input type="date" className={inputCls} disabled={!canEdit} value={form.delivery_date || ''} onChange={(e) => setField('delivery_date', e.target.value)} /></Field>
          )}
          <Field label={t('sales.fields.customer_reference')}><input className={inputCls} disabled={!canEdit} value={form.customer_reference || ''} onChange={(e) => setField('customer_reference', e.target.value)} /></Field>
          {docType === 'invoice' && (
            <>
              <Field label={t('sales.fields.payment_terms')}><input type="number" min="0" className={inputCls} disabled={!canEdit} value={form.payment_terms_days ?? ''} onChange={(e) => setField('payment_terms_days', e.target.value)} /></Field>
              <Field label={t('sales.fields.buyer_reference')}><input className={inputCls} disabled={!canEdit} value={form.buyer_reference || ''} onChange={(e) => setField('buyer_reference', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('sales.fields.skonto_days')}><input type="number" min="0" className={inputCls} disabled={!canEdit} value={form.skonto_days ?? ''} onChange={(e) => setField('skonto_days', e.target.value)} /></Field>
                <Field label={t('sales.fields.skonto_percent')}><input type="number" min="0" step="0.5" className={inputCls} disabled={!canEdit} value={form.skonto_percent ?? ''} onChange={(e) => setField('skonto_percent', e.target.value)} /></Field>
              </div>
            </>
          )}
          {locked && doc.due_date && <Field label={t('sales.fields.due')}><div className="pt-2 text-sm font-semibold">{dateDE(doc.due_date)}</div></Field>}
        </div>
      </Card>

      {/* Lines */}
      <Card className="mb-6 overflow-x-auto p-0">
        <table className="min-w-[860px]">
          <thead>
            <tr>
              <th className="w-10">{t('sales.fields.pos')}</th>
              <th className="w-44">{t('sales.fields.item')}</th>
              <th>{t('sales.fields.description')}</th>
              <th className="w-24 text-right">{t('sales.fields.quantity')}</th>
              <th className="w-20">{t('sales.fields.unit')}</th>
              {showPrices && <th className="w-28 text-right">{t('sales.fields.unit_price')}</th>}
              {showPrices && <th className="w-20 text-right">{t('sales.fields.discount')}</th>}
              {showPrices && <th className="w-20">{t('sales.fields.vat')}</th>}
              {showPrices && <th className="w-28 text-right">{t('sales.fields.line_total')}</th>}
              {canEdit && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const lineNet = Number(l.quantity || 0) * Number(l.unit_price || 0) * (1 - Number(l.discount_percent || 0) / 100);
              return (
                <tr key={l.id || `n${i}`} className="align-top">
                  <td className="pt-4 text-sm text-muted-foreground">{i + 1}</td>
                  <td>
                    <select className={inputCls} disabled={!canEdit} value={l.item_id || ''} onChange={(e) => pickItem(i, e.target.value)}>
                      <option value="">{t('sales.editor.pick_item')}</option>
                      {items.map((it) => <option key={it.id} value={it.id}>{it.item_code} · {it.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <textarea rows={Math.max(1, String(l.description || '').split('\n').length)} className={`${inputCls} h-auto min-h-10 py-2`} disabled={!canEdit}
                      value={l.description || ''} onChange={(e) => setLine(i, { description: e.target.value })} />
                  </td>
                  <td><input type="number" min="0" step="any" className={`${inputCls} text-right`} disabled={!canEdit} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                  <td><input className={inputCls} disabled={!canEdit} value={l.unit || ''} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
                  {showPrices && <td><input type="number" step="0.01" className={`${inputCls} text-right`} disabled={!canEdit} value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></td>}
                  {showPrices && <td><input type="number" min="0" max="100" step="0.5" className={`${inputCls} text-right`} disabled={!canEdit} value={l.discount_percent} onChange={(e) => setLine(i, { discount_percent: e.target.value })} /></td>}
                  {showPrices && (
                    <td>
                      {treatment === 'domestic' ? (
                        <select className={inputCls} disabled={!canEdit} value={Number(l.tax_rate) === 7 ? 7 : 19} onChange={(e) => setLine(i, { tax_rate: Number(e.target.value) })}>
                          <option value={19}>19 %</option><option value={7}>7 %</option>
                        </select>
                      ) : <div className="pt-2 text-sm text-muted-foreground">0 %</div>}
                    </td>
                  )}
                  {showPrices && <td className="pt-4 text-right text-sm tabular-nums">{eur(locked ? l.line_net : lineNet)}</td>}
                  {canEdit && (
                    <td className="pt-2">
                      <button type="button" aria-label="remove line" className="rounded p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                        onClick={() => { setLines((ls) => ls.filter((_, idx) => idx !== i)); setDirty(true); }}><X size={14} /></button>
                    </td>
                  )}
                </tr>
              );
            })}
            {!lines.length && <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">{t('sales.editor.no_lines')}</td></tr>}
          </tbody>
        </table>
        {canEdit && (
          <div className="border-t border-border p-3">
            <Button size="sm" variant="ghost" onClick={() => { setLines((ls) => [...ls, emptyLine()]); setDirty(true); }}><Plus size={14} className="mr-1" />{t('sales.actions.add_line')}</Button>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Texts */}
        <Card className="space-y-4 lg:col-span-2">
          <Field label={t('sales.fields.intro_text')}><textarea rows={2} className={`${inputCls} h-auto py-2`} disabled={!canEdit} value={form.intro_text || ''} onChange={(e) => setField('intro_text', e.target.value)} /></Field>
          <Field label={t('sales.fields.closing_text')}><textarea rows={2} className={`${inputCls} h-auto py-2`} disabled={!canEdit} value={form.closing_text || ''} onChange={(e) => setField('closing_text', e.target.value)} /></Field>
          <Field label={t('sales.fields.internal_notes')}><textarea rows={2} className={`${inputCls} h-auto py-2`} disabled={!canEdit} value={form.internal_notes || ''} onChange={(e) => setField('internal_notes', e.target.value)} /></Field>
        </Card>

        {/* Totals */}
        {showPrices && (
          <Card>
            <h3 className="mb-3 font-semibold">{t('sales.editor.totals')}</h3>
            <dl className="space-y-1 text-sm tabular-nums">
              <div className="flex justify-between"><dt>{t('sales.fields.net')}</dt><dd>{eur(locked ? doc.net_total : totals.net)}</dd></div>
              {(locked ? doc.tax_breakdown.map((b) => ({ rate: b.tax_rate, base: b.net_amount, tax: b.tax_amount })) : totals.breakdown).map((b) => (
                <div key={b.rate} className="flex justify-between text-muted-foreground"><dt>{num(b.rate, 2)} % USt. ({eur(b.base)})</dt><dd>{eur(b.tax)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-border pt-2 text-base font-bold"><dt>{t('sales.fields.gross')}</dt><dd>{eur(locked ? doc.gross_total : totals.gross)}</dd></div>
              {locked && doc.open_amount !== null && (
                <div className="flex justify-between pt-1 font-semibold text-accent"><dt>{t('sales.fields.open')}</dt><dd>{eur(doc.open_amount)}</dd></div>
              )}
            </dl>
          </Card>
        )}
      </div>

      {/* Issued document: follow-ups */}
      {locked && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card className="space-y-3">
            <h3 className="font-semibold">{t('sales.editor.related')}</h3>
            <div className="flex flex-wrap gap-2">
              {EDIT_ROLES.includes(user?.role) && doc.conversions.map((target) => (
                <Button key={target} size="sm" variant="secondary" onClick={() => convert(target)}>
                  <ArrowRight size={14} className="mr-1" />{t('sales.actions.convert_to', { type: t(`sales.types.${target}`) })}
                </Button>
              ))}
              {doc.doc_type === 'quote' && doc.status === 'issued' && EDIT_ROLES.includes(user?.role) && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setQuoteStatus('accepted')}>{t('sales.actions.accept')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setQuoteStatus('declined')}>{t('sales.actions.decline')}</Button>
                </>
              )}
            </div>
            <ul className="divide-y divide-border text-sm">
              {doc.related.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <Link className="text-accent hover:underline" to={`/sales/documents/${r.id}`}>{t(`sales.types.${r.doc_type}`)} {r.number || `(${t('sales.status.draft')})`}</Link>
                  <StatusPill status={r.status} t={t} />
                </li>
              ))}
            </ul>
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{t('sales.editor.files')}</h3>
              <Button size="sm" variant="ghost" onClick={verify}><ShieldCheck size={14} className="mr-1" />{t('sales.actions.verify')}</Button>
            </div>
            {integrity && (
              <p className={`text-sm ${integrity.content_unchanged && integrity.files_unchanged ? 'text-emerald-700' : 'font-bold text-rose-700'}`}>
                {integrity.content_unchanged && integrity.files_unchanged ? t('sales.editor.integrity_ok') : t('sales.editor.integrity_bad')}
              </p>
            )}
            <ul className="divide-y divide-border text-sm">
              {doc.files.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-2">
                  <span className="truncate">{f.filename}</span>
                  <Button size="sm" variant="ghost" onClick={() => downloadFile(`/sales/${doc.id}/files/${f.id}`, f.filename).catch((err) => toast.error(apiError(err, t('sales.messages.error'))))}>
                    <Download size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>

          {doc.doc_type === 'invoice' && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{t('sales.editor.payments')}</h3>
                {canAccount && doc.open_amount > 0 && !payment && (
                  <Button size="sm" variant="secondary" onClick={() => setPayment({ payment_date: todayISO(), amount: doc.open_amount, method: 'bank_transfer', reference: doc.number, skonto_amount: 0 })}>
                    {t('sales.actions.record_payment')}
                  </Button>
                )}
              </div>
              {payment && (
                <form onSubmit={recordPayment} className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-3">
                  <Field label={t('sales.editor.payment_date')}><input type="date" required className={inputCls} value={payment.payment_date} onChange={(e) => setPayment({ ...payment, payment_date: e.target.value })} /></Field>
                  <Field label={t('sales.editor.amount')}><input type="number" step="0.01" required className={inputCls} value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></Field>
                  <Field label={t('sales.editor.skonto_amount')}><input type="number" step="0.01" min="0" className={inputCls} value={payment.skonto_amount} onChange={(e) => setPayment({ ...payment, skonto_amount: e.target.value })} /></Field>
                  <Field label={t('sales.editor.reference')}><input className={inputCls} value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} /></Field>
                  <div className="col-span-2 flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPayment(null)}>✕</Button>
                    <Button type="submit" size="sm">{t('sales.actions.record_payment')}</Button>
                  </div>
                </form>
              )}
              <ul className="divide-y divide-border text-sm">
                {doc.payments.map((p) => (
                  <li key={p.id} className="flex justify-between py-2 tabular-nums">
                    <span>{dateDE(p.payment_date)} · {p.reference}</span>
                    <span>{eur(p.amount)}{Number(p.skonto_amount) > 0 && ` + ${eur(p.skonto_amount)} Skonto`}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {doc.doc_type === 'invoice' && (
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{t('sales.editor.reminders')}</h3>
                {canAccount && doc.open_amount > 0 && doc.dunning_level < 3 && (
                  <Button size="sm" variant="secondary" onClick={sendReminder}>{t('sales.dunning.levels.' + (doc.dunning_level + 1))}</Button>
                )}
              </div>
              <ul className="divide-y divide-border text-sm">
                {reminders.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2">
                    <span>{dateDE(r.notice_date)} · {t(`sales.dunning.levels.${r.level}`)} · {r.number}</span>
                    {r.file_id && <Button size="sm" variant="ghost" onClick={() => openFile(`/sales/${doc.id}/files/${r.file_id}`).catch(() => {})}><FileText size={14} /></Button>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* Issue dialog */}
      {issueDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6" role="dialog" aria-modal="true" onClick={() => setIssueDialog(false)}>
          <Card className="w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">{t('sales.actions.issue')}</h3>
            <p className="text-sm text-muted-foreground">
              {docType === 'invoice' ? t('sales.editor.issue_invoice_confirm') : t('sales.editor.issue_confirm', { type: t(`sales.types.${docType}`) })}
            </p>
            {docType === 'order' && (
              <div className="space-y-2 rounded-xl bg-muted/40 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={production.enabled} onChange={(e) => setProduction({ ...production, enabled: e.target.checked })} />
                  {t('sales.editor.create_production')}
                </label>
                {production.enabled && (
                  <Field label={t('sales.editor.planned_start')}>
                    <input type="datetime-local" className={inputCls} value={production.planned_start} onChange={(e) => setProduction({ ...production, planned_start: e.target.value })} />
                  </Field>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setIssueDialog(false)}>✕</Button>
              <Button size="sm" onClick={issue} disabled={busy}><Send size={14} className="mr-1" />{t('sales.actions.issue')}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
