/**
 * Capacity: machine load per week (heat map) and delivery date check.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { CalendarCheck } from 'lucide-react';
import api from '../../api/axios';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../sales/components';
import { dateDE, apiError } from '../../lib/format';

const cls = 'h-9 rounded-lg border border-border bg-white px-2 text-sm';
const color = (p) => (p === null ? 'bg-muted' : p > 100 ? 'bg-rose-500 text-white' : p >= 85 ? 'bg-amber-400' : p >= 50 ? 'bg-emerald-300' : p > 0 ? 'bg-emerald-100' : 'bg-white');
const kw = (d) => { const x = new Date(`${d}T00:00:00Z`); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day + 3); const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 4)); return 1 + Math.round(((x - y) / 86400000 - 3 + ((y.getUTCDay() + 6) % 7)) / 7); };

function Check({ t }) {
  const [items, setItems] = useState([]);
  const [f, setF] = useState({ item_id: '', quantity: '', desired_date: '' });
  const [r, setR] = useState(null);
  useEffect(() => { api.get('/items').then((x) => setItems((x.data || []).filter((i) => i.type !== 'raw_material'))).catch(() => {}); }, []);
  const run = async (e) => {
    e.preventDefault();
    try { setR((await api.post('/capacity/check', { item_id: Number(f.item_id), quantity: f.quantity, desired_date: f.desired_date || undefined })).data); } catch (err) { toast.error(apiError(err, t('cap.error'))); }
  };
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold"><CalendarCheck size={18} />{t('cap.check_title')}</h2>
      <form onSubmit={run} className="flex flex-wrap items-end gap-2 text-xs">
        <label className="min-w-[14rem] flex-1">{t('cap.item')}<br /><select required className={`${cls} w-full`} value={f.item_id} onChange={(e) => setF({ ...f, item_id: e.target.value })}><option value="" />{items.map((i) => <option key={i.id} value={i.id}>{i.item_code} · {i.name}</option>)}</select></label>
        <label>{t('cap.quantity')}<br /><input required type="number" min="1" className={`${cls} w-24`} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></label>
        <label>{t('cap.desired')}<br /><input type="date" className={cls} value={f.desired_date} onChange={(e) => setF({ ...f, desired_date: e.target.value })} /></label>
        <Button size="sm" type="submit">{t('cap.check')}</Button>
      </form>
      {r && (
        <div className="space-y-2 text-sm">
          <div className={`rounded-lg px-3 py-2 font-semibold ${r.feasible === false ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {t('cap.earliest', { date: dateDE(r.earliest_delivery_date) })}
            {r.feasible === false && ` · ${t('cap.late', { days: r.days_late })}`}
            {r.feasible === true && ` · ${t('cap.ok')}`}
          </div>
          {r.material.filter((m) => m.short).map((m) => <div key={m.item_code} className="text-xs text-amber-700">{t('cap.material_short', { item: m.item_code, days: m.lead_time_days })}</div>)}
          <ol className="list-decimal pl-5 text-xs text-muted-foreground">
            {r.steps.map((s) => <li key={s.sequence}>{s.step_type === 'external' ? `${t('sub.external')}: ${s.supplier_name}` : s.machine_name} · {String(s.start).slice(0, 16)} → {String(s.end).slice(0, 16)}{s.waits_for_machine ? ` · ${t('cap.queue')}` : ''}</li>)}
          </ol>
        </div>
      )}
    </Card>
  );
}

export default function CapacityPage() {
  const { t } = useTranslation();
  const [weeks, setWeeks] = useState(8);
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/capacity/load', { params: { weeks } }).then((r) => setData(r.data)).catch((err) => toast.error(apiError(err, t('cap.error')))); }, [weeks, t]);
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title={t('shell.nav.capacity')}>
        <select className={cls} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>{[4, 8, 12, 26].map((w) => <option key={w} value={w}>{t('cap.weeks', { n: w })}</option>)}</select>
      </PageHeader>
      {data && (
        <div className="table-container overflow-x-auto">
          <table>
            <thead><tr><th>{t('cap.machine')}</th>{data.weeks.map((w) => <th key={w} className="text-center">KW {kw(w)}<div className="text-[10px] font-normal text-muted-foreground">{dateDE(w)}</div></th>)}</tr></thead>
            <tbody>
              {data.machines.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}<div className="text-xs text-muted-foreground">{m.weekly_hours} h/{t('cap.week')}</div></td>
                  {m.weeks.map((w) => (
                    <td key={w.week} className="p-1 text-center">
                      <div className={`rounded-md px-1 py-2 text-xs font-semibold ${color(w.load_percent)}`} title={`${w.planned_hours} h`}>{w.load_percent === null ? '-' : `${w.load_percent} %`}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('cap.hint')}</p>
      <Check t={t} />
    </div>
  );
}
