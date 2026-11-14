import { hasAnyRole } from '../../lib/roles';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Upload, Download, Check, X, Banknote, UserPlus, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../contexts/AuthContext';
import { eur, num, dateDE, apiError, downloadFile } from '../../lib/format';
import { PageHeader } from './components';

const STATUSES = ['all', 'received', 'approved', 'rejected', 'paid'];
const DECIDERS = ['administrator', 'accounting'];
const STATUS_COLORS = { received: 'bg-blue-50 text-blue-700', approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700', paid: 'bg-slate-100 text-slate-600' };

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Detail({ id, onChanged, t, canDecide }) {
  const [inv, setInv] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const load = useCallback(() => api.get(`/purchase-invoices/${id}`).then((r) => setInv(r.data)).catch((err) => toast.error(apiError(err, t('sales.messages.error')))), [id, t]);
  useEffect(() => { load(); api.get('/suppliers').then((r) => setSuppliers(r.data)).catch(() => {}); }, [load]);
  if (!inv) return null;
  const d = inv.invoice;

  const act = async (fn) => {
    try { await fn(); toast.success(t('sales.messages.saved')); load(); onChanged(); } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); }
  };

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{d.type_code === '381' ? t('sales.incoming.credit_note') : t('sales.types.invoice')} {inv.invoice_number}</h2>
          <p className="text-sm text-muted-foreground">{inv.format} · {inv.original_filename}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => downloadFile(`/purchase-invoices/${id}/original`, inv.original_filename).catch(() => {})}><Download size={14} className="mr-1" />{t('sales.incoming.original')}</Button>
          {canDecide && inv.status === 'received' && <>
            <Button size="sm" onClick={() => act(() => api.post(`/purchase-invoices/${id}/status`, { status: 'approved' }))}><Check size={14} className="mr-1" />{t('sales.incoming.approve')}</Button>
            <Button size="sm" variant="secondary" onClick={() => act(() => api.post(`/purchase-invoices/${id}/status`, { status: 'rejected' }))}><X size={14} className="mr-1" />{t('sales.incoming.reject')}</Button>
          </>}
          {canDecide && inv.status === 'approved' && (
            <Button size="sm" variant="secondary" onClick={() => act(() => api.post(`/purchase-invoices/${id}/status`, { status: 'paid' }))}><Banknote size={14} className="mr-1" />{t('sales.incoming.mark_paid')}</Button>
          )}
        </div>
      </div>

      {inv.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle size={16} />{t('sales.incoming.warnings')}</div>
          <ul className="list-disc pl-5">{inv.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3 text-sm">
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground">{t('sales.incoming.seller')}</div>
          <div className="font-medium">{d.seller.name}</div>
          <div className="whitespace-pre-line text-muted-foreground">{[d.seller.street, [d.seller.postal_code, d.seller.city].filter(Boolean).join(' '), d.seller.country].filter(Boolean).join('\n')}</div>
          <div className="text-muted-foreground">{d.seller.vat_id && `USt-IdNr. ${d.seller.vat_id}`}{d.seller.tax_number && ` · StNr. ${d.seller.tax_number}`}</div>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{t('sales.fields.date')}</dt><dd>{dateDE(d.issue_date)}</dd>
          <dt className="text-muted-foreground">{t('sales.fields.due')}</dt><dd>{dateDE(d.due_date) || '—'}</dd>
          <dt className="text-muted-foreground">{t('sales.fields.service_date')}</dt><dd>{dateDE(d.delivery_date) || '—'}</dd>
          <dt className="text-muted-foreground">{t('sales.incoming.order_ref')}</dt><dd>{d.order_reference || '—'}</dd>
          <dt className="text-muted-foreground">IBAN</dt><dd className="break-all">{d.iban || '—'}</dd>
        </dl>
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-muted-foreground">{t('sales.incoming.supplier')}</span>
            <select className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm" value={inv.supplier_id || ''}
              onChange={(e) => act(() => api.put(`/purchase-invoices/${id}`, { supplier_id: e.target.value || null, po_id: null }))}>
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {!inv.supplier_id && <Button size="sm" variant="ghost" onClick={() => act(() => api.post(`/purchase-invoices/${id}/create-supplier`))}><UserPlus size={14} className="mr-1" />{t('sales.incoming.create_supplier')}</Button>}
          {inv.purchase_order && (
            <div className="rounded-lg bg-muted/50 p-2 text-xs">
              {t('sales.incoming.po')} {inv.purchase_order.po_number || `#${inv.purchase_order.id}`}: {eur(inv.purchase_order.net_total)} {t('sales.fields.net')}
              {Math.abs(inv.purchase_order.net_total - inv.net_total) > 0.01 && <span className="ml-1 font-semibold text-amber-700">({t('sales.incoming.differs')} {eur(inv.net_total - inv.purchase_order.net_total)})</span>}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>{t('sales.fields.pos')}</th><th>{t('sales.fields.description')}</th><th className="text-right">{t('sales.fields.quantity')}</th><th className="text-right">{t('sales.fields.unit_price')}</th><th>{t('sales.fields.vat')}</th><th className="text-right">{t('sales.fields.line_total')}</th></tr></thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.position}</td>
                <td>{l.item_code && <span className="font-mono text-xs text-muted-foreground">{l.item_code} · </span>}{l.name}{l.description && <div className="text-xs text-muted-foreground">{l.description}</div>}</td>
                <td className="text-right tabular-nums">{num(l.quantity)} {l.unit}</td>
                <td className="text-right tabular-nums">{l.unit_price !== null ? eur(l.unit_price) : ''}</td>
                <td>{l.tax_rate !== null ? `${num(l.tax_rate, 2)} %` : ''} {l.tax_category && l.tax_category !== 'S' ? `(${l.tax_category})` : ''}</td>
                <td className="text-right tabular-nums">{eur(l.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto max-w-sm space-y-1 text-sm tabular-nums">
        <div className="flex justify-between"><dt>{t('sales.fields.net')}</dt><dd>{eur(d.totals.net)}</dd></div>
        {d.taxes.map((x, i) => <div key={i} className="flex justify-between text-muted-foreground"><dt>{num(x.rate, 2)} % USt. ({eur(x.base)}){x.category !== 'S' ? ` ${x.category}` : ''}</dt><dd>{eur(x.amount)}</dd></div>)}
        <div className="flex justify-between border-t border-border pt-1 font-bold"><dt>{t('sales.fields.gross')}</dt><dd>{eur(d.totals.gross)}</dd></div>
        {d.totals.due !== null && d.totals.due !== d.totals.gross && <div className="flex justify-between"><dt>{t('sales.incoming.due_amount')}</dt><dd>{eur(d.totals.due)}</dd></div>}
      </dl>
      {(d.payment_terms || d.notes.length > 0) && (
        <div className="whitespace-pre-line rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">{[d.payment_terms, ...d.notes].filter(Boolean).join('\n')}</div>
      )}
    </Card>
  );
}

export default function IncomingInvoicesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState([]);
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(() => Number(params.get('id')) || null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);

  const load = useCallback(() => api.get(`/purchase-invoices${status !== 'all' ? `?status=${status}` : ''}`).then((r) => setRows(r.data)).catch((err) => toast.error(apiError(err, t('sales.messages.error')))), [status, t]);
  useEffect(() => { load(); }, [load]);

  const uploadFiles = async (files) => {
    setUploading(true);
    for (const file of files) {
      try {
        if (file.size > 15 * 1024 * 1024) throw new Error('> 15 MB');
        const res = await api.post('/purchase-invoices', { filename: file.name, content_base64: await readAsBase64(file) });
        toast.success(`${file.name}: ${res.data.invoice_number}`);
        setSelected(res.data.id);
      } catch (err) {
        toast.error(`${file.name}: ${apiError(err, err.message)}`, { duration: 8000 });
      }
    }
    setUploading(false);
    load();
  };

  return (
    <div>
      <PageHeader title={t('sales.incoming.title')}>
        <input ref={fileInput} type="file" accept=".pdf,.xml,application/pdf,application/xml,text/xml" multiple hidden onChange={(e) => { uploadFiles([...e.target.files]); e.target.value = ''; }} />
        <Button size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}><Upload size={14} className="mr-1" />{t('sales.incoming.upload')}</Button>
      </PageHeader>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); uploadFiles([...e.dataTransfer.files]); }}
        className={`mb-6 rounded-2xl border-2 border-dashed p-6 text-center text-sm transition ${dragOver ? 'border-accent bg-accent/5' : 'border-border text-muted-foreground'}`}
      >
        {uploading ? '…' : t('sales.incoming.drop_hint')}
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-muted p-1" role="tablist">
        {STATUSES.map((s) => (
          <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-sm ${status === s ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {t(`sales.incoming.status.${s}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="table-container overflow-x-auto self-start">
          <table>
            <thead><tr><th>{t('sales.incoming.seller')}</th><th>{t('sales.fields.number')}</th><th>{t('sales.fields.date')}</th><th className="text-right">{t('sales.fields.gross')}</th><th>{t('sales.fields.status')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`cursor-pointer hover:bg-muted/50 ${selected === r.id ? 'bg-accent/5' : ''}`} onClick={() => setSelected(r.id)}>
                  <td>{r.seller_name}{r.warnings.length > 0 && <AlertTriangle size={14} className="ml-1 inline text-amber-600" aria-label={t('sales.incoming.warnings')} />}</td>
                  <td className="font-mono text-sm">{r.invoice_number}</td>
                  <td>{dateDE(r.invoice_date)}</td>
                  <td className="text-right tabular-nums">{eur(r.gross_total)}</td>
                  <td><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[r.status]}`}>{t(`sales.incoming.status.${r.status}`)}</span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">—</td></tr>}
            </tbody>
          </table>
        </div>
        {selected && <Detail key={selected} id={selected} t={t} canDecide={hasAnyRole(user, DECIDERS)} onChanged={load} />}
      </div>
    </div>
  );
}
