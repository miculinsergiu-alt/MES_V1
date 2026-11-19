/**
 * Quality: customer complaints with 8D, and gauges with calibration dates.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { FileText, Plus, CheckCircle2 } from 'lucide-react';
import api from '../../api/axios';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../sales/components';
import Attachments from '../../components/Attachments';
import { dateDE, apiError, openFile } from '../../lib/format';

const cls = 'h-9 w-full rounded-lg border border-border bg-white px-2 text-sm';
const D8 = ['d1_team', 'd2_problem', 'd3_containment', 'd4_root_cause', 'd5_corrective', 'd6_implemented', 'd7_prevention', 'd8_closure'];
const STATUSES = ['open', 'analysis', 'action', 'closed', 'rejected'];

function ComplaintEditor({ complaint, customers, onSaved, onClose, t }) {
  const [f, setF] = useState(() => ({ status: 'open', description: '', ...complaint }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      const body = Object.fromEntries(['customer_id', 'lot_number', 'customer_reference', 'quantity', 'description', 'status', 'cost', 'due_date', ...D8]
        .map((k) => [k, f[k] === '' || f[k] === null ? undefined : f[k]]));
      if (body.customer_id) body.customer_id = Number(body.customer_id);
      const r = f.id ? await api.put(`/quality/complaints/${f.id}`, body) : await api.post('/quality/complaints', body);
      toast.success(t('qm.saved'));
      onSaved(r.data);
    } catch (err) { toast.error(apiError(err, t('qm.error'))); }
  };
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{f.number || t('qm.new_complaint')}</h3>
        <div className="flex gap-2">
          {f.id && <Button size="sm" variant="secondary" onClick={() => openFile(`/quality/complaints/${f.id}/8d.pdf`).catch(() => {})}><FileText size={14} className="mr-1" />8D PDF</Button>}
          <Button size="sm" variant="ghost" onClick={onClose}>✕</Button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs">{t('qm.customer')}<select className={cls} value={f.customer_id || ''} onChange={set('customer_id')}><option value="" />{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="text-xs">{t('qm.lot')}<input className={cls} value={f.lot_number || ''} onChange={set('lot_number')} /></label>
        <label className="text-xs">{t('qm.reference')}<input className={cls} value={f.customer_reference || ''} onChange={set('customer_reference')} /></label>
        <label className="text-xs">{t('qm.status_label')}<select className={cls} value={f.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s} value={s}>{t(`qm.cstatus.${s}`)}</option>)}</select></label>
        <label className="text-xs">{t('qm.quantity')}<input className={cls} type="number" min="0" value={f.quantity ?? ''} onChange={set('quantity')} /></label>
        <label className="text-xs">{t('qm.cost')}<input className={cls} type="number" min="0" step="0.01" value={f.cost ?? ''} onChange={set('cost')} /></label>
        <label className="text-xs">{t('qm.due_date')}<input className={cls} type="date" value={f.due_date || ''} onChange={set('due_date')} /></label>
      </div>
      <label className="block text-xs">{t('qm.description')}<textarea rows={2} className={`${cls} h-auto py-2`} value={f.description} onChange={set('description')} /></label>
      <div className="grid gap-2 sm:grid-cols-2">
        {D8.map((k) => (
          <label key={k} className="block text-xs">{t(`qm.d8.${k}`)}<textarea rows={2} className={`${cls} h-auto py-2`} value={f[k] || ''} onChange={set(k)} /></label>
        ))}
      </div>
      <Button size="sm" onClick={save}>{t('qm.save')}</Button>
      {f.id && <Attachments ownerType="complaint" ownerId={f.id} kinds={['photo', 'report', 'other']} />}
    </Card>
  );
}

function Complaints({ t }) {
  const [filter, setFilter] = useState('open');
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => { api.get('/quality/complaints', { params: { status: filter } }).then((r) => setRows(r.data)).catch(() => {}); }, [filter]);
  useEffect(() => { load(); api.get('/customers').then((r) => setCustomers(r.data)).catch(() => {}); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 text-sm">
          {['open', 'closed', 'all'].map((s) => <button key={s} type="button" onClick={() => setFilter(s)} className={`rounded-md px-3 py-1 ${filter === s ? 'bg-accent text-white' : 'bg-muted text-muted-foreground'}`}>{t(`qm.filter.${s}`)}</button>)}
        </div>
        <Button size="sm" onClick={() => setEditing({})}><Plus size={14} className="mr-1" />{t('qm.new_complaint')}</Button>
      </div>
      {editing && <ComplaintEditor complaint={editing} customers={customers} t={t} onClose={() => setEditing(null)} onSaved={(c) => { setEditing(c); load(); }} />}
      {!rows.length && <p className="text-sm text-muted-foreground">{t('qm.no_complaints')}</p>}
      {rows.map((c) => (
        <Card key={c.id} className="cursor-pointer hover:border-accent" onClick={() => setEditing(c)}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div><span className="font-mono font-semibold">{c.number}</span> · {c.customer_name || '-'} · {c.item_code || ''} {c.lot_number ? `· ${c.lot_number}` : ''}</div>
            <div className="flex items-center gap-2"><span className="rounded bg-muted px-2 py-0.5 text-xs">{t(`qm.cstatus.${c.status}`)}</span><span className="text-xs text-muted-foreground">{dateDE(c.created_at)}</span></div>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">{c.description}</p>
        </Card>
      ))}
    </div>
  );
}

function Gauges({ t }) {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ code: '', name: '', interval_months: 12, last_calibrated: '' });
  const load = () => api.get('/quality/gauges').then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);
  const add = async (e) => {
    e.preventDefault();
    try { await api.post('/quality/gauges', { ...f, last_calibrated: f.last_calibrated || undefined }); setF({ code: '', name: '', interval_months: 12, last_calibrated: '' }); load(); } catch (err) { toast.error(apiError(err, t('qm.error'))); }
  };
  const calibrated = async (g) => { try { await api.post(`/quality/gauges/${g.id}/calibrated`, {}); load(); } catch (err) { toast.error(apiError(err, t('qm.error'))); } };
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-xs">
        <label>{t('qm.code')}<input className={`${cls} w-28`} required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
        <label className="min-w-[12rem] flex-1">{t('qm.gauge_name')}<input className={cls} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>{t('qm.interval')}<input className={`${cls} w-20`} type="number" min="1" value={f.interval_months} onChange={(e) => setF({ ...f, interval_months: e.target.value })} /></label>
        <label>{t('qm.last_calibrated')}<input className={`${cls} w-36`} type="date" value={f.last_calibrated} onChange={(e) => setF({ ...f, last_calibrated: e.target.value })} /></label>
        <Button size="sm" type="submit"><Plus size={14} /></Button>
      </form>
      <div className="table-container overflow-x-auto">
        <table>
          <thead><tr><th>{t('qm.code')}</th><th>{t('qm.gauge_name')}</th><th>{t('qm.last_calibrated')}</th><th>{t('qm.next_due')}</th><th /></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className={g.active ? '' : 'opacity-50'}>
                <td className="font-mono">{g.code}</td><td>{g.name}</td><td>{dateDE(g.last_calibrated)}</td>
                <td className={g.overdue ? 'font-semibold text-rose-600' : ''}>{dateDE(g.next_due)}{g.overdue && ` · ${t('qm.overdue')}`}</td>
                <td className="text-right"><button type="button" onClick={() => calibrated(g)} className="inline-flex items-center gap-1 text-xs text-accent"><CheckCircle2 size={14} />{t('qm.calibrated_today')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function QualityPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('complaints');
  return (
    <div className="max-w-6xl">
      <PageHeader title={t('shell.nav.quality')}>
        <div className="flex rounded-lg border border-border bg-white p-1 text-sm">
          {['complaints', 'gauges'].map((x) => <button key={x} type="button" onClick={() => setTab(x)} className={`rounded-md px-3 py-1 ${tab === x ? 'bg-accent text-white' : 'text-muted-foreground'}`}>{t(`qm.tab.${x}`)}</button>)}
        </div>
      </PageHeader>
      {tab === 'complaints' ? <Complaints t={t} /> : <Gauges t={t} />}
    </div>
  );
}
