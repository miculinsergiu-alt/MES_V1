/**
 * Inspection plan (Prüfplan) of an item: characteristics with nominal size,
 * limits, frequency and gauge. Saved separately from the item form.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Plus, Trash2, ClipboardCheck } from 'lucide-react';
import api from '../api/axios';
import { apiError } from '../lib/format';

const cls = 'h-9 w-full rounded-lg border border-border bg-white px-2 text-sm';
const empty = () => ({ name: '', kind: 'measure', nominal: '', lower_limit: '', upper_limit: '', unit: 'mm', frequency: 'first', every_n: '', critical: 0, gauge_id: '' });

export default function InspectionPlanEditor({ itemId }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [gauges, setGauges] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/quality/plans/${itemId}`).then((r) => setRows(r.data.map((x) => ({ ...x, nominal: x.nominal ?? '', lower_limit: x.lower_limit ?? '', upper_limit: x.upper_limit ?? '', every_n: x.every_n ?? '', gauge_id: x.gauge_id ?? '' })))).catch(() => {});
    api.get('/quality/gauges').then((r) => setGauges(r.data.filter((g) => g.active))).catch(() => {});
  }, [itemId]);

  const set = (i, patch) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  // Nominal ± tolerance helper: typing "25" and "-0.021/0" fills the limits.
  const tol = (i, text) => {
    const r = rows[i];
    const m = String(text).replace(/,/g, '.').match(/^\s*([+-]?\d*\.?\d+)\s*\/\s*([+-]?\d*\.?\d+)\s*$/);
    if (m && r.nominal !== '') set(i, { lower_limit: +(Number(r.nominal) + Number(m[1])).toFixed(5), upper_limit: +(Number(r.nominal) + Number(m[2])).toFixed(5) });
  };

  const save = async () => {
    setBusy(true);
    try {
      const characteristics = rows.filter((r) => r.name.trim()).map((r) => ({
        id: r.id, name: r.name, kind: r.kind, unit: r.unit || 'mm', frequency: r.frequency, critical: r.critical ? 1 : 0, incoming: r.incoming ? 1 : 0,
        nominal: r.nominal === '' ? undefined : r.nominal, lower_limit: r.lower_limit === '' ? undefined : r.lower_limit,
        upper_limit: r.upper_limit === '' ? undefined : r.upper_limit, every_n: r.every_n === '' ? undefined : r.every_n,
        gauge_id: r.gauge_id || undefined,
      }));
      const res = await api.put(`/quality/plans/${itemId}`, { characteristics });
      setRows(res.data.map((x) => ({ ...x, nominal: x.nominal ?? '', lower_limit: x.lower_limit ?? '', upper_limit: x.upper_limit ?? '', every_n: x.every_n ?? '', gauge_id: x.gauge_id ?? '' })));
      toast.success(t('qm.plan_saved'));
    } catch (err) { toast.error(apiError(err, t('qm.error'))); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck size={16} />{t('qm.plan')}</h3>
        <button type="button" onClick={() => setRows([...rows, empty()])} className="flex items-center gap-1 text-sm text-accent"><Plus size={14} />{t('qm.add_characteristic')}</button>
      </div>
      {!rows.length && <p className="text-sm text-muted-foreground">{t('qm.plan_empty')}</p>}
      {rows.map((r, i) => (
        <div key={r.id || `n${i}`} className="grid grid-cols-2 gap-2 rounded-lg bg-muted/30 p-2 text-xs sm:grid-cols-12">
          <input className={`${cls} sm:col-span-3`} placeholder={t('qm.name_ph')} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
          <select className={`${cls} sm:col-span-2`} value={r.kind} onChange={(e) => set(i, { kind: e.target.value })}>
            <option value="measure">{t('qm.kind.measure')}</option><option value="attribute">{t('qm.kind.attribute')}</option>
          </select>
          {r.kind === 'measure' ? (
            <>
              <input className={cls} type="number" step="any" placeholder={t('qm.nominal')} value={r.nominal} onChange={(e) => set(i, { nominal: e.target.value })} />
              <input className={cls} placeholder={t('qm.tol_ph')} title={t('qm.tol_hint')} onBlur={(e) => tol(i, e.target.value)} />
              <input className={cls} type="number" step="any" placeholder={t('qm.min')} value={r.lower_limit} onChange={(e) => set(i, { lower_limit: e.target.value })} />
              <input className={cls} type="number" step="any" placeholder={t('qm.max')} value={r.upper_limit} onChange={(e) => set(i, { upper_limit: e.target.value })} />
            </>
          ) : <div className="sm:col-span-4" />}
          <select className={cls} value={r.frequency} onChange={(e) => set(i, { frequency: e.target.value })}>
            {['first', 'every_n', 'final', 'each'].map((f) => <option key={f} value={f}>{t(`qm.freq.${f}`)}</option>)}
          </select>
          {r.frequency === 'every_n'
            ? <input className={cls} type="number" min="1" placeholder="n" value={r.every_n} onChange={(e) => set(i, { every_n: e.target.value })} />
            : <select className={cls} value={r.gauge_id} onChange={(e) => set(i, { gauge_id: e.target.value })}>
                <option value="">{t('qm.gauge')}</option>
                {gauges.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}
              </select>}
          <div className="flex items-center justify-between gap-1">
            <label className="flex items-center gap-1" title={t('qm.critical')}><input type="checkbox" checked={!!r.critical} onChange={(e) => set(i, { critical: e.target.checked ? 1 : 0 })} />!</label>
            <label className="flex items-center gap-1" title={t('qm.incoming_hint')}><input type="checkbox" checked={!!r.incoming} onChange={(e) => set(i, { incoming: e.target.checked ? 1 : 0 })} />WE</label>
            <button type="button" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} className="text-rose-600"><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
      <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{t('qm.save_plan')}</button>
    </div>
  );
}
