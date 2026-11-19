/**
 * Blanket orders (Rahmenaufträge): agreed total quantities and prices for a
 * period; call-offs become order confirmations.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Plus, Trash2, PackagePlus } from 'lucide-react';
import api from '../../api/axios';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { PageHeader } from './components';
import { eur, num, dateDE, apiError } from '../../lib/format';

const cls = 'h-9 w-full rounded-lg border border-border bg-white px-2 text-sm';

function NewBlanket({ onCreated, onClose, t }) {
  const [customers, setCustomers] = useState([]);
  const [items, setItems] = useState([]);
  const [f, setF] = useState({ customer_id: '', customer_reference: '', valid_from: '', valid_to: '', lines: [{ item_id: '', quantity: '', unit_price: '' }] });
  useEffect(() => {
    api.get('/customers').then((r) => setCustomers(r.data)).catch(() => {});
    api.get('/items').then((r) => setItems((r.data || []).filter((i) => i.type !== 'raw_material'))).catch(() => {});
  }, []);
  const setLine = (i, patch) => setF({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) });
  const save = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/blanket-orders', {
        customer_id: Number(f.customer_id), customer_reference: f.customer_reference || undefined,
        valid_from: f.valid_from || undefined, valid_to: f.valid_to || undefined,
        lines: f.lines.filter((l) => l.item_id && l.quantity).map((l) => ({ item_id: Number(l.item_id), quantity: l.quantity, unit_price: l.unit_price || 0 })),
      });
      onCreated(r.data);
    } catch (err) { toast.error(apiError(err, t('blanket.error'))); }
  };
  return (
    <Card>
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-4 text-xs">
          <label>{t('blanket.customer')}<select required className={cls} value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}><option value="" />{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{t('blanket.reference')}<input className={cls} value={f.customer_reference} onChange={(e) => setF({ ...f, customer_reference: e.target.value })} /></label>
          <label>{t('blanket.valid_from')}<input type="date" className={cls} value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></label>
          <label>{t('blanket.valid_to')}<input type="date" className={cls} value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} /></label>
        </div>
        {f.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 text-xs">
            <select className={`${cls} col-span-6`} value={l.item_id} onChange={(e) => { const it = items.find((x) => String(x.id) === e.target.value); setLine(i, { item_id: e.target.value, unit_price: l.unit_price || it?.unit_price || '' }); }}>
              <option value="">{t('blanket.item')}</option>{items.map((it) => <option key={it.id} value={it.id}>{it.item_code} · {it.name}</option>)}
            </select>
            <input type="number" min="0" step="any" placeholder={t('blanket.quantity')} className={`${cls} col-span-2`} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
            <input type="number" min="0" step="0.0001" placeholder={t('blanket.price')} className={`${cls} col-span-3`} value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} />
            <button type="button" className="col-span-1 text-rose-600" onClick={() => setF({ ...f, lines: f.lines.filter((_, idx) => idx !== i) })}><Trash2 size={14} /></button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setF({ ...f, lines: [...f.lines, { item_id: '', quantity: '', unit_price: '' }] })}><Plus size={14} /></Button>
          <Button type="submit" size="sm">{t('blanket.create')}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>✕</Button>
        </div>
      </form>
    </Card>
  );
}

function Blanket({ b, onChanged, t }) {
  const navigate = useNavigate();
  const [q, setQ] = useState({});
  const [date, setDate] = useState('');
  const callOff = async () => {
    const lines = Object.entries(q).filter(([, x]) => Number(x) > 0).map(([id, x]) => ({ line_id: Number(id), quantity: x }));
    if (!lines.length) return;
    try {
      const r = await api.post(`/blanket-orders/${b.id}/call-off`, { delivery_date: date || undefined, lines });
      toast.success(t('blanket.called_off'));
      onChanged();
      navigate(`/sales/documents/${r.data.document.id}`);
    } catch (err) { toast.error(apiError(err, t('blanket.error'))); }
  };
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><span className="font-mono font-semibold">{b.number}</span> · {b.customer_name}{b.customer_reference && ` · ${b.customer_reference}`}</div>
        <div className="text-xs text-muted-foreground">
          {dateDE(b.valid_from)} – {dateDE(b.valid_to)} · <span className={b.expired ? 'text-rose-600' : ''}>{t(`blanket.status.${b.expired && b.status === 'active' ? 'expired' : b.status}`)}</span>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-muted-foreground"><th className="text-left">{t('blanket.item')}</th><th className="text-right">{t('blanket.quantity')}</th><th className="text-right">{t('blanket.called')}</th><th className="text-right">{t('blanket.remaining')}</th><th className="text-right">{t('blanket.price')}</th>{b.status === 'active' && <th className="text-right">{t('blanket.call_off')}</th>}</tr></thead>
        <tbody>
          {b.lines.map((l) => (
            <tr key={l.id} className="border-t border-border/60">
              <td>{l.item_code ? `${l.item_code} · ${l.item_name}` : l.description}</td>
              <td className="text-right tabular-nums">{num(l.quantity)} {l.unit}</td>
              <td className="text-right tabular-nums">{num(l.called_off)}</td>
              <td className={`text-right tabular-nums ${l.remaining <= 0 ? 'text-muted-foreground' : 'font-semibold'}`}>{num(l.remaining)}</td>
              <td className="text-right tabular-nums">{eur(l.unit_price)}</td>
              {b.status === 'active' && <td className="text-right"><input type="number" min="0" max={l.remaining} step="any" className="h-8 w-24 rounded border border-border px-2 text-right" value={q[l.id] ?? ''} onChange={(e) => setQ({ ...q, [l.id]: e.target.value })} disabled={l.remaining <= 0} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {b.status === 'active' && (
        <div className="flex flex-wrap items-end justify-end gap-2 text-xs">
          <label>{t('blanket.delivery_date')}<br /><input type="date" className="h-8 rounded border border-border px-2" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <Button size="sm" onClick={callOff}><PackagePlus size={14} className="mr-1" />{t('blanket.call_off')}</Button>
        </div>
      )}
      {b.calloffs.length > 0 && (
        <div className="text-xs text-muted-foreground">{t('blanket.calloffs')}: {b.calloffs.map((c) => (
          <button key={c.sales_document_id} type="button" className="mr-2 text-accent hover:underline" onClick={() => navigate(`/sales/documents/${c.sales_document_id}`)}>{c.number || t('blanket.draft')} ({num(c.quantity)})</button>
        ))}</div>
      )}
    </Card>
  );
}

export default function BlanketOrdersPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('active');
  const [rows, setRows] = useState([]);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => { api.get('/blanket-orders', { params: { status } }).then((r) => setRows(r.data)).catch(() => {}); }, [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('shell.nav.blanket_orders')}>
        <div className="flex rounded-lg border border-border bg-white p-1 text-sm">
          {['active', 'closed', 'all'].map((s) => <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-md px-3 py-1 ${status === s ? 'bg-accent text-white' : 'text-muted-foreground'}`}>{t(`blanket.filter.${s}`)}</button>)}
        </div>
        <Button size="sm" onClick={() => setCreating(true)}><Plus size={14} className="mr-1" />{t('blanket.new')}</Button>
      </PageHeader>
      <p className="text-sm text-muted-foreground">{t('blanket.intro')}</p>
      {creating && <NewBlanket t={t} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
      {!rows.length && <Card><p className="text-sm text-muted-foreground">{t('blanket.empty')}</p></Card>}
      {rows.map((b) => <Blanket key={b.id} b={b} t={t} onChanged={load} />)}
    </div>
  );
}
