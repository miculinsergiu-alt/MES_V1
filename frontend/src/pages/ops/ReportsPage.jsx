import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileSpreadsheet } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../contexts/AuthContext';
import { hasAnyRole } from '../../lib/roles';
import { eur, num, dateDE, apiError, downloadFile } from '../../lib/format';
import { PageHeader } from '../sales/components';

const inputCls = 'h-10 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent';
const year = new Date().getFullYear();

// Which roles may open which report (the server checks the same).
const TABS = [
  { key: 'sales', url: '/reports/sales', roles: ['administrator', 'planner', 'accounting', 'sales'], period: true },
  { key: 'stock', url: '/reports/stock-value', roles: ['administrator', 'planner', 'accounting', 'warehouse_manager', 'material_planner'], period: false },
  { key: 'delivery', url: '/reports/on-time-delivery', roles: ['administrator', 'planner', 'accounting', 'sales'], period: true },
];

const pct = (v) => (v === null || v === undefined ? '—' : `${num(v, 1)} %`);
const STATE_CLS = { on_time: 'text-emerald-700', late: 'text-amber-700', overdue: 'text-rose-700', open: 'text-muted-foreground' };

function Kpi({ label, value, sub, tone = '' }) {
  return <Card><div className="text-sm text-muted-foreground">{label}</div><div className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</div>{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</Card>;
}

export default function ReportsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const tabs = TABS.filter((x) => hasAnyRole(user, x.roles));
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((x) => x.key === params.get('r')) || tabs[0];
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [groupBy, setGroupBy] = useState('customer');
  const [loaded, setLoaded] = useState(null); // { key, data } — data belongs to one tab + query

  const query = new URLSearchParams({ from, to, group_by: groupBy }).toString();
  const key = tab ? `${tab.url}?${query}` : null;
  useEffect(() => {
    if (!key) return;
    api.get(key).then((r) => setLoaded({ key, data: r.data })).catch((err) => toast.error(apiError(err, t('sales.messages.error'))));
  }, [key, t]);

  if (!tab) return null;
  const data = loaded?.key === key ? loaded.data : null;
  const lang = (i18n.resolvedLanguage || 'de').startsWith('de') ? 'de' : 'en';
  const excel = () => downloadFile(`${tab.url}?${query}&format=xlsx&lang=${lang}`, `${tab.key}.xlsx`)
    .catch((err) => toast.error(apiError(err, t('sales.messages.error'))));

  return (
    <div>
      <PageHeader title={t('ops.reports.title')}>
        <Button variant="secondary" onClick={excel}><FileSpreadsheet size={16} className="mr-1" aria-hidden />{t('ops.reports.excel')}</Button>
      </PageHeader>

      <div role="tablist" className="mb-4 flex flex-wrap gap-2 border-b border-border">
        {tabs.map((x) => (
          <button key={x.key} role="tab" type="button" aria-selected={x.key === tab.key} onClick={() => setParams({ r: x.key })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${x.key === tab.key ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t(`ops.reports.tab.${x.key}`)}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        {tab.period && <>
          <label className="space-y-1 text-sm"><span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('ops.reports.from')}</span><input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="space-y-1 text-sm"><span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('ops.reports.to')}</span><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </>}
        {tab.key === 'sales' && (
          <label className="space-y-1 text-sm"><span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('ops.reports.group_by')}</span>
            <select className={inputCls} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="customer">{t('ops.reports.by_customer')}</option>
              <option value="item">{t('ops.reports.by_item')}</option>
            </select>
          </label>
        )}
        {tab.key === 'stock' && <p className="text-sm text-muted-foreground">{t('ops.reports.stock_hint')}</p>}
      </div>

      {data && tab.key === 'sales' && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Kpi label={t('ops.reports.col.revenue')} value={eur(data.totals.revenue)} />
            <Kpi label={t('ops.reports.col.cost')} value={eur(data.totals.cost)} />
            <Kpi label={t('ops.reports.col.margin')} value={eur(data.totals.margin)} sub={pct(data.totals.margin_percent)} />
          </div>
          <div className="table-container overflow-x-auto">
            <table>
              <thead><tr>
                {groupBy === 'item' ? <><th>{t('ops.reports.col.item_code')}</th><th>{t('ops.reports.col.item_name')}</th><th className="text-right">{t('ops.reports.col.quantity')}</th></> : <th>{t('ops.reports.col.customer_name')}</th>}
                <th className="text-right">{t('ops.reports.col.revenue')}</th><th className="text-right">{t('ops.reports.col.cost')}</th><th className="text-right">{t('ops.reports.col.margin')}</th><th className="text-right">%</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i}>
                    {groupBy === 'item' ? <><td className="font-mono text-sm">{r.item_code}</td><td>{r.item_name}</td><td className="text-right tabular-nums">{num(r.quantity)}</td></> : <td>{r.customer_name}</td>}
                    <td className="text-right tabular-nums">{eur(r.revenue)}</td>
                    <td className="text-right tabular-nums">{eur(r.cost)}</td>
                    <td className={`text-right tabular-nums ${r.margin < 0 ? 'text-rose-700' : ''}`}>{eur(r.margin)}</td>
                    <td className="text-right tabular-nums">{pct(r.margin_percent)}</td>
                  </tr>
                ))}
                {!data.rows.length && <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">{t('ops.reports.empty')}</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('ops.reports.sales_hint')}</p>
        </>
      )}

      {data && tab.key === 'stock' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Kpi label={t('ops.reports.total_value')} value={eur(data.totals.value)} />
            {['raw_material', 'semi_finished', 'finished_good'].map((k) => (
              <Kpi key={k} label={t(`ops.reports.type.${k}`)} value={eur(data.totals.by_type[k] || 0)} />
            ))}
          </div>
          {data.totals.negative_items > 0 && <p className="mb-3 text-sm text-rose-700">{t('ops.reports.negative_items', { count: data.totals.negative_items })}</p>}
          <div className="table-container overflow-x-auto">
            <table>
              <thead><tr><th>{t('ops.reports.col.item_code')}</th><th>{t('ops.reports.col.item_name')}</th><th>{t('ops.reports.col.type')}</th><th className="text-right">{t('ops.reports.col.quantity')}</th><th className="text-right">{t('ops.reports.col.unit_cost')}</th><th className="text-right">{t('ops.reports.col.value')}</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.item_code}>
                    <td className="font-mono text-sm">{r.item_code}</td><td>{r.item_name}</td><td>{t(`ops.reports.type.${r.type}`, { defaultValue: r.type })}</td>
                    <td className={`text-right tabular-nums ${r.quantity < 0 ? 'text-rose-700' : ''}`}>{num(r.quantity)} {r.uom}</td>
                    <td className="text-right tabular-nums">{eur(r.unit_cost)}</td>
                    <td className="text-right tabular-nums">{eur(r.value)}</td>
                  </tr>
                ))}
                {!data.rows.length && <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">{t('ops.reports.empty')}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data && tab.key === 'delivery' && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Kpi label={t('ops.reports.otd_rate')} value={pct(data.totals.rate)} sub={t('ops.reports.otd_sub', { on_time: data.totals.on_time, due: data.totals.due })} />
            <Kpi label={t('ops.reports.state.overdue')} value={data.rows.filter((r) => r.state === 'overdue').length} tone="text-rose-700" />
            <Kpi label={t('ops.reports.state.open')} value={data.rows.filter((r) => r.state === 'open').length} />
          </div>
          <div className="table-container overflow-x-auto">
            <table>
              <thead><tr><th>{t('ops.reports.col.number')}</th><th>{t('ops.reports.col.customer_name')}</th><th>{t('ops.reports.col.delivery_date')}</th><th>{t('ops.reports.col.last_delivery')}</th><th className="text-right">{t('ops.reports.col.delivered')}</th><th>{t('ops.reports.col.state')}</th><th className="text-right">{t('ops.reports.col.days_late')}</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-sm"><Link className="hover:underline" to={`/sales/documents/${r.id}`}>{r.number}</Link></td>
                    <td>{r.customer_name}</td><td>{dateDE(r.delivery_date)}</td><td>{dateDE(r.last_delivery) || '—'}</td>
                    <td className="text-right tabular-nums">{num(r.delivered)} / {num(r.ordered)}</td>
                    <td className={`font-medium ${STATE_CLS[r.state]}`}>{t(`ops.reports.state.${r.state}`)}</td>
                    <td className="text-right tabular-nums">{r.days_late || '—'}</td>
                  </tr>
                ))}
                {!data.rows.length && <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">{t('ops.reports.empty')}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
