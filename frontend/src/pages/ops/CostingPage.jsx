import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { eur, num, dateDE, apiError, downloadFile } from '../../lib/format';
import { PageHeader } from '../sales/components';

const inputCls = 'h-10 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent';
const year = new Date().getFullYear();

/** Coloured deviation: over plan is red, under plan green. */
function Deviation({ value }) {
  if (!value) return <span className="text-muted-foreground">±0</span>;
  return <span className={`tabular-nums font-semibold ${value > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{value > 0 ? '+' : ''}{eur(value)}</span>;
}

const pct = (v) => (v === null || v === undefined ? '—' : `${num(v, 1)} %`);

function CostingDetail({ id }) {
  const { t } = useTranslation();
  const [c, setC] = useState(null);
  useEffect(() => {
    api.get(`/reports/costing/${id}`).then((r) => setC(r.data)).catch((err) => toast.error(apiError(err, t('sales.messages.error'))));
  }, [id, t]);
  if (!c) return null;
  const rows = ['material', 'machine', 'labour', ...(c.planned.external || c.actual.external ? ['external'] : []), 'total'];
  return (
    <div className="space-y-6">
      <Link to="/costing" className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><ArrowLeft size={14} aria-hidden />{t('ops.costing.back')}</Link>
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-xl font-bold">#{c.order.id} · {c.order.product_name}</div>
            <div className="text-sm text-muted-foreground">
              {c.order.item_code} · {num(c.order.quantity)} {t('ops.costing.pieces')} · {t(`status.${c.order.status}`, { defaultValue: c.order.status })}
              {c.order.sales_order && <> · <Link className="text-accent hover:underline" to={`/sales/documents/${c.order.sales_order.id}`}>{c.order.sales_order.number} {c.order.sales_order.customer_name}</Link></>}
            </div>
          </div>
          <div className="text-right text-sm">
            <div>{t('ops.costing.deviation')}: <Deviation value={c.deviation} /></div>
            <div className="text-muted-foreground">{t('ops.costing.labor_rate')}: {eur(c.labor_rate)}/h</div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><div className="text-sm text-muted-foreground">{t('ops.costing.actual_per_piece')}</div><div className="text-2xl font-bold tabular-nums">{eur(c.actual.per_piece)}</div><div className="text-xs text-muted-foreground">{t('ops.costing.plan')}: {eur(c.planned.per_piece)}</div></Card>
        <Card><div className="text-sm text-muted-foreground">{t('ops.costing.actual_margin')}</div><div className={`text-2xl font-bold tabular-nums ${c.actual.margin < 0 ? 'text-rose-700' : ''}`}>{eur(c.actual.margin)}</div><div className="text-xs text-muted-foreground">{pct(c.actual.margin_percent)} · {t('ops.costing.plan')}: {eur(c.planned.margin)}</div></Card>
        <Card><div className="text-sm text-muted-foreground">{t('ops.costing.good_scrap')}</div><div className="text-2xl font-bold tabular-nums">{num(c.actual.quantity)} / {num(c.actual.scrap)}</div><div className="text-xs text-muted-foreground">{t('ops.costing.of_planned', { qty: num(c.planned.quantity) })}</div></Card>
      </div>

      <div className="table-container overflow-x-auto">
        <table>
          <thead><tr><th>{t('ops.costing.cost_type')}</th><th className="text-right">{t('ops.costing.plan')}</th><th className="text-right">{t('ops.costing.actual')}</th><th className="text-right">{t('ops.costing.deviation')}</th></tr></thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k} className={k === 'total' ? 'font-semibold' : ''}>
                <td>{k === 'external' ? t('sub.external_cost') : t(`ops.costing.type.${k}`)}</td>
                <td className="text-right tabular-nums">{eur(c.planned[k])}</td>
                <td className="text-right tabular-nums">{eur(c.actual[k])}</td>
                <td className="text-right"><Deviation value={Math.round((c.actual[k] - c.planned[k]) * 100) / 100} /></td>
              </tr>
            ))}
            <tr><td>{t('ops.costing.revenue')}</td><td className="text-right tabular-nums">{eur(c.planned.revenue)}</td><td className="text-right tabular-nums">{eur(c.actual.revenue)}</td><td /></tr>
          </tbody>
        </table>
      </div>

      {c.times_estimated && <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">{t('ops.costing.estimated_hint')}</p>}
      <div className="grid gap-6 2xl:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">{t('ops.costing.materials')}</h2>
          <div className="table-container overflow-x-auto">
            <table>
              <thead><tr><th>{t('ops.costing.item')}</th><th className="text-right">{t('ops.costing.plan_qty')}</th><th className="text-right">{t('ops.costing.actual_qty')}</th><th className="text-right">{t('ops.costing.actual')}</th></tr></thead>
              <tbody>
                {c.materials.map((m) => (
                  <tr key={m.item_id}>
                    <td>{m.item_code} · {m.name}</td>
                    <td className="text-right tabular-nums">{num(m.planned_qty)} {m.uom}</td>
                    <td className="text-right tabular-nums">{num(m.actual_qty)} {m.uom}</td>
                    <td className="text-right tabular-nums">{eur(m.actual_cost)}</td>
                  </tr>
                ))}
                {!c.materials.length && <tr><td colSpan={4} className="text-center text-sm text-muted-foreground">{t('ops.costing.no_bom')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">{t('ops.costing.steps')}</h2>
          <div className="table-container overflow-x-auto">
            <table>
              <thead><tr><th>{t('ops.costing.machine')}</th><th className="text-right">{t('ops.costing.plan_hours')}</th><th className="text-right">{t('ops.costing.actual_hours')}</th><th className="text-right">{t('ops.costing.actual')}</th></tr></thead>
              <tbody>
                {c.steps.map((s) => (
                  <tr key={s.order_id}>
                    <td>{s.machine_name} <span className="text-xs text-muted-foreground">({eur(s.hourly_rate)}/h)</span></td>
                    <td className="text-right tabular-nums">{num(s.planned_hours, 2)} h</td>
                    <td className="text-right tabular-nums">{num(s.actual_machine_hours, 2)} h{s.estimated && <span className="ml-1 text-amber-700" title={t('ops.costing.estimated')}>*</span>}</td>
                    <td className="text-right tabular-nums">{eur(s.actual_machine_cost + s.actual_labour_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {c.steps.every((s) => !s.hourly_rate) && <p className="mt-2 text-xs text-amber-700">{t('ops.costing.no_rates')}</p>}
        </div>
      </div>
    </div>
  );
}

export default function CostingPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [status, setStatus] = useState('done');
  const [rows, setRows] = useState([]);

  const params = useCallback(() => new URLSearchParams({ from, to, ...(status ? { status } : {}) }).toString(), [from, to, status]);
  useEffect(() => {
    if (id) return;
    api.get(`/reports/costing?${params()}`).then((r) => setRows(r.data)).catch((err) => toast.error(apiError(err, t('sales.messages.error'))));
  }, [id, params, t]);

  if (id) return <div><PageHeader title={t('ops.costing.title')} /><CostingDetail id={id} /></div>;

  const sum = (k1, k2) => Math.round(rows.reduce((s, r) => s + (r[k1][k2] || 0), 0) * 100) / 100;
  const lang = (i18n.resolvedLanguage || 'de').startsWith('de') ? 'de' : 'en';

  return (
    <div>
      <PageHeader title={t('ops.costing.title')}>
        <Button variant="secondary" onClick={() => downloadFile(`/reports/costing?${params()}&format=xlsx&lang=${lang}`, 'costing.xlsx').catch((err) => toast.error(apiError(err, t('sales.messages.error'))))}>
          <FileSpreadsheet size={16} className="mr-1" aria-hidden />{t('ops.reports.excel')}
        </Button>
      </PageHeader>
      <p className="-mt-4 mb-6 max-w-3xl text-sm text-muted-foreground">{t('ops.costing.intro')}</p>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm"><span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('ops.reports.from')}</span><input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="space-y-1 text-sm"><span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('ops.reports.to')}</span><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="space-y-1 text-sm"><span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('ops.costing.status')}</span>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="done">{t('ops.costing.only_done')}</option>
            <option value="">{t('ops.costing.all')}</option>
          </select>
        </label>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><div className="text-sm text-muted-foreground">{t('ops.costing.planned_total')}</div><div className="text-2xl font-bold tabular-nums">{eur(sum('planned', 'total'))}</div></Card>
        <Card><div className="text-sm text-muted-foreground">{t('ops.costing.actual_total')}</div><div className="text-2xl font-bold tabular-nums">{eur(sum('actual', 'total'))}</div></Card>
        <Card><div className="text-sm text-muted-foreground">{t('ops.costing.actual_margin')}</div><div className="text-2xl font-bold tabular-nums">{eur(sum('actual', 'margin'))}</div></Card>
      </div>
      <div className="table-container overflow-x-auto">
        <table>
          <thead><tr>
            <th>{t('ops.costing.order')}</th><th>{t('ops.costing.product')}</th><th>{t('ops.costing.date')}</th>
            <th className="text-right">{t('ops.costing.good_qty')}</th><th className="text-right">{t('ops.costing.plan')}</th><th className="text-right">{t('ops.costing.actual')}</th>
            <th className="text-right">{t('ops.costing.deviation')}</th><th className="text-right">{t('ops.costing.per_piece')}</th><th className="text-right">{t('ops.costing.margin')}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/costing/${r.id}`)}>
                <td className="font-mono text-sm">#{r.id}</td>
                <td>{r.product_name}{r.sales_order && <div className="text-xs text-muted-foreground">{r.sales_order.number} · {r.sales_order.customer_name}</div>}</td>
                <td>{dateDE(r.actual_end || r.planned_start)}</td>
                <td className="text-right tabular-nums">{num(r.actual.quantity)} / {num(r.quantity)}</td>
                <td className="text-right tabular-nums">{eur(r.planned.total)}</td>
                <td className="text-right tabular-nums">{eur(r.actual.total)}{r.times_estimated && <span className="ml-1 text-amber-700" title={t('ops.costing.estimated')}>*</span>}</td>
                <td className="text-right"><Deviation value={r.deviation} /></td>
                <td className="text-right tabular-nums">{eur(r.actual.per_piece)}</td>
                <td className={`text-right tabular-nums ${r.actual.margin < 0 ? 'text-rose-700' : ''}`}>{eur(r.actual.margin)} <span className="text-xs text-muted-foreground">{pct(r.actual.margin_percent)}</span></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="py-8 text-center text-sm text-muted-foreground">{t('ops.costing.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
