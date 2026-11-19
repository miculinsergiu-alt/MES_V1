/**
 * Projects: one customer job across documents, production, purchasing and
 * outside processing; budget vs. actual.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Plus, X, Link2 } from 'lucide-react';
import api from '../../api/axios';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../sales/components';
import Attachments from '../../components/Attachments';
import { eur, dateDE, apiError } from '../../lib/format';

const cls = 'h-9 rounded-lg border border-border bg-white px-2 text-sm';

function Kpi({ label, value, sub, warn }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${warn ? 'text-rose-600' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function LinkAdder({ projectId, onChanged, t }) {
  const [kind, setKind] = useState('sales_document');
  const [options, setOptions] = useState([]);
  const [ref, setRef] = useState('');
  useEffect(() => {
    setRef('');
    const load = {
      sales_document: () => api.get('/sales').then((r) => r.data.map((d) => ({ id: d.id, label: `${d.number || t('blanket.draft')} · ${d.customer_name || ''} · ${t(`sales.types.${d.doc_type}`)}` }))),
      purchase_order: () => api.get('/procurement/purchase-orders').then((r) => r.data.map((p) => ({ id: p.id, label: `${p.po_number} · ${p.supplier_name}` }))),
      production_order: () => api.get('/orders').then((r) => r.data.filter((o) => !o.parent_order_id && o.order_type === 'production').map((o) => ({ id: o.id, label: `#${o.id} · ${o.product_name}` }))),
      subcontract_job: () => api.get('/subcontracting', { params: {} }).then((r) => r.data.map((j) => ({ id: j.id, label: `${j.description} · ${j.supplier_name}` }))),
    }[kind];
    load().then(setOptions).catch(() => setOptions([]));
  }, [kind, t]);
  const add = async () => {
    if (!ref) return;
    try { await api.post(`/projects/${projectId}/links`, { kind, ref_id: Number(ref) }); onChanged(); setRef(''); } catch (err) { toast.error(apiError(err, t('proj.error'))); }
  };
  return (
    <div className="flex flex-wrap items-end gap-2 text-xs">
      <select className={cls} value={kind} onChange={(e) => setKind(e.target.value)}>
        {['sales_document', 'production_order', 'purchase_order', 'subcontract_job'].map((k) => <option key={k} value={k}>{t(`proj.kind.${k}`)}</option>)}
      </select>
      <select className={`${cls} min-w-[16rem] flex-1`} value={ref} onChange={(e) => setRef(e.target.value)}><option value="" />{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      <Button size="sm" onClick={add}><Link2 size={14} className="mr-1" />{t('proj.link')}</Button>
    </div>
  );
}

function Detail({ id, onClose, t }) {
  const [p, setP] = useState(null);
  const load = useCallback(() => { api.get(`/projects/${id}`).then((r) => setP(r.data)).catch(() => {}); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!p) return null;
  const unlink = async (kind, refId) => { try { await api.delete(`/projects/${id}/links/${kind}/${refId}`); load(); } catch (err) { toast.error(apiError(err, t('proj.error'))); } };
  const Row = ({ kind, refId, children }) => (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm">{children}
      <button type="button" className="text-muted-foreground hover:text-rose-600" title={t('proj.unlink')} onClick={() => unlink(kind, refId)}><X size={14} /></button></li>
  );
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><span className="font-mono font-semibold">{p.number}</span> · {p.name} {p.customer_name && <span className="text-muted-foreground">· {p.customer_name}</span>}</div>
        <Button size="sm" variant="ghost" onClick={onClose}>✕</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label={t('proj.ordered')} value={eur(p.revenue.ordered)} sub={`${t('proj.quoted')} ${eur(p.revenue.quoted)}`} />
        <Kpi label={t('proj.invoiced')} value={eur(p.revenue.invoiced)} />
        <Kpi label={t('proj.cost')} value={eur(p.cost.total)} sub={p.budget_cost ? `${t('proj.budget')} ${eur(p.budget_cost)} · ${p.budget_used_percent} %` : null} warn={p.over_budget} />
        <Kpi label={t('proj.margin')} value={eur(p.margin)} sub={p.margin_percent !== null ? `${p.margin_percent} %` : null} warn={p.margin < 0} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold">{t('proj.kind.sales_document')}</h3>
          <ul className="divide-y divide-border">{p.documents.map((d) => <Row key={d.id} kind="sales_document" refId={d.id}><Link className="text-accent hover:underline" to={`/sales/documents/${d.id}`}>{d.number || t('blanket.draft')} · {t(`sales.types.${d.doc_type}`)}</Link><span className="ml-auto tabular-nums">{eur(d.net_total)}</span></Row>)}</ul>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold">{t('proj.kind.production_order')}</h3>
          <ul className="divide-y divide-border">{p.production.map((o) => <Row key={o.id} kind="production_order" refId={o.id}><Link className="text-accent hover:underline" to={`/costing/${o.id}`}>#{o.id} · {o.product_name}</Link><span className="ml-auto tabular-nums">{eur(o.actual)}</span></Row>)}</ul>
          <h3 className="mb-1 mt-3 text-sm font-semibold">{t('proj.kind.purchase_order')}</h3>
          <ul className="divide-y divide-border">{p.purchase_orders.map((x) => <Row key={x.id} kind="purchase_order" refId={x.id}><span>{x.po_number} · {x.supplier_name}</span><span className="ml-auto tabular-nums">{eur(x.value)}</span></Row>)}</ul>
          {p.subcontract_jobs.length > 0 && <>
            <h3 className="mb-1 mt-3 text-sm font-semibold">{t('proj.kind.subcontract_job')}</h3>
            <ul className="divide-y divide-border">{p.subcontract_jobs.map((x) => <Row key={x.id} kind="subcontract_job" refId={x.id}><span>{x.description} · {x.supplier_name}</span><span className="ml-auto tabular-nums">{eur(x.cost)}</span></Row>)}</ul>
          </>}
        </div>
      </div>
      <LinkAdder projectId={p.id} onChanged={load} t={t} />
      <p className="text-xs text-muted-foreground">{t('proj.hint')}</p>
      <Attachments ownerType="project" ownerId={p.id} kinds={['drawing', 'report', 'photo', 'other']} title={t('proj.files')} />
    </Card>
  );
}

export default function ProjectsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [f, setF] = useState(null);
  const load = useCallback(() => { api.get('/projects', { params: { status } }).then((r) => setRows(r.data)).catch(() => {}); }, [status]);
  useEffect(() => { load(); api.get('/customers').then((r) => setCustomers(r.data)).catch(() => {}); }, [load]);
  const create = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/projects', { ...f, customer_id: f.customer_id ? Number(f.customer_id) : undefined, due_date: f.due_date || undefined });
      setF(null); load(); setSelected(r.data.id);
    } catch (err) { toast.error(apiError(err, t('proj.error'))); }
  };
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('shell.nav.projects')}>
        <div className="flex rounded-lg border border-border bg-white p-1 text-sm">
          {['open', 'closed', 'all'].map((s) => <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-md px-3 py-1 ${status === s ? 'bg-accent text-white' : 'text-muted-foreground'}`}>{t(`proj.filter.${s}`)}</button>)}
        </div>
        <Button size="sm" onClick={() => setF({ name: '', customer_id: '', budget_cost: '', budget_revenue: '', due_date: '' })}><Plus size={14} className="mr-1" />{t('proj.new')}</Button>
      </PageHeader>
      {f && (
        <Card>
          <form onSubmit={create} className="flex flex-wrap items-end gap-2 text-xs">
            <label className="min-w-[14rem] flex-1">{t('proj.name')}<br /><input required className={`${cls} w-full`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label>{t('proj.customer')}<br /><select className={cls} value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}><option value="" />{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>{t('proj.budget')}<br /><input type="number" min="0" className={`${cls} w-28`} value={f.budget_cost} onChange={(e) => setF({ ...f, budget_cost: e.target.value })} /></label>
            <label>{t('proj.due')}<br /><input type="date" className={cls} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></label>
            <Button size="sm" type="submit">{t('proj.create')}</Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setF(null)}>✕</Button>
          </form>
        </Card>
      )}
      {selected && <Detail id={selected} t={t} onClose={() => { setSelected(null); load(); }} />}
      <div className="table-container overflow-x-auto">
        <table>
          <thead><tr><th>{t('proj.number')}</th><th>{t('proj.name')}</th><th>{t('proj.customer')}</th><th className="text-right">{t('proj.ordered')}</th><th className="text-right">{t('proj.cost')}</th><th className="text-right">{t('proj.margin')}</th><th>{t('proj.due')}</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(p.id)}>
                <td className="font-mono">{p.number}</td><td>{p.name}</td><td>{p.customer_name || '-'}</td>
                <td className="text-right tabular-nums">{eur(p.revenue.ordered)}</td>
                <td className={`text-right tabular-nums ${p.over_budget ? 'text-rose-600' : ''}`}>{eur(p.cost.total)}{p.budget_used_percent !== null && <span className="text-xs text-muted-foreground"> ({p.budget_used_percent} %)</span>}</td>
                <td className={`text-right tabular-nums ${p.margin < 0 ? 'text-rose-600' : ''}`}>{eur(p.margin)}</td>
                <td>{dateDE(p.due_date)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="text-center text-sm text-muted-foreground">{t('proj.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
