/**
 * Measurements of a production order: what is due (first article, every n
 * parts, final), entry form, hold banner, report PDF, release for quality.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Ruler, ShieldAlert, FileText } from 'lucide-react';
import api from '../api/axios';
import { apiError, openFile } from '../lib/format';

const fmt = (x) => (x === null || x === undefined || x === '' ? '' : Number(x).toLocaleString(undefined, { maximumFractionDigits: 4 }));

export default function OrderInspection({ orderId, canRelease = false, large = false }) {
  const { t } = useTranslation();
  const [st, setSt] = useState(null);
  const [stage, setStage] = useState('first');
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/quality/orders/${orderId}/inspection`).then((r) => {
      setSt(r.data);
      if (r.data.due[0]) setStage(r.data.due[0].stage);
    }).catch(() => setSt(null));
  }, [orderId]);
  useEffect(() => { load(); }, [load]);

  if (!st || !st.plan.length) return null;
  const dueIds = new Set(st.due.filter((d) => d.stage === stage).map((d) => d.characteristic_id));
  const shown = st.plan.filter((c) => dueIds.has(c.id) || (stage !== 'first' && c.frequency === 'each'));
  const list = shown.length ? shown : st.plan;

  const submit = async () => {
    const values = list.filter((c) => vals[c.id] !== undefined && vals[c.id] !== '').map((c) => (c.kind === 'attribute'
      ? { characteristic_id: c.id, ok: vals[c.id] === 'ok' }
      : { characteristic_id: c.id, value: String(vals[c.id]).replace(',', '.') }));
    if (!values.length) return;
    setBusy(true);
    try {
      const r = await api.post(`/quality/orders/${orderId}/measurements`, { stage, values });
      if (r.data.hold) toast.error(t('qm.nok_hold'), { duration: 8000 }); else toast.success(t('qm.ok_saved'));
      setVals({});
      load();
    } catch (err) { toast.error(apiError(err, t('qm.error'))); } finally { setBusy(false); }
  };
  const release = async () => {
    try { await api.post(`/quality/orders/${orderId}/release`); load(); } catch (err) { toast.error(apiError(err, t('qm.error'))); }
  };
  const inputCls = `${large ? 'h-12 text-lg' : 'h-9 text-sm'} w-28 rounded-lg border border-border bg-white px-2 text-right font-mono`;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Ruler size={18} />{t('qm.inspection')}</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {st.due.length > 0 && <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">{t('qm.due', { count: st.due.length })}</span>}
          <button type="button" onClick={() => openFile(`/quality/orders/${orderId}/report.pdf`).catch(() => {})} className="flex items-center gap-1 text-accent"><FileText size={14} />{t('qm.report')}</button>
        </div>
      </div>
      {!!st.order.quality_hold && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <ShieldAlert size={16} /> {t('qm.hold')}
          {canRelease && <button type="button" onClick={release} className="ml-auto rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white">{t('qm.release')}</button>}
        </div>
      )}
      <div className="flex gap-1 text-sm">
        {['first', 'in_process', 'final'].map((s) => (
          <button key={s} type="button" onClick={() => setStage(s)} className={`rounded-md px-3 py-1 ${stage === s ? 'bg-accent text-white' : 'bg-muted text-muted-foreground'}`}>{t(`qm.stage.${s}`)}</button>
        ))}
      </div>
      <div className="space-y-2">
        {list.map((c) => {
          const last = [...st.measurements].reverse().find((m) => m.characteristic_id === c.id);
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-[10rem] flex-1">
                <div className={`font-medium ${large ? 'text-lg' : 'text-sm'}`}>{c.name}{c.critical ? ' *' : ''}</div>
                <div className="text-xs text-muted-foreground">
                  {c.kind === 'measure' ? `${fmt(c.lower_limit)} … ${fmt(c.upper_limit)} ${c.unit}` : t('qm.kind.attribute')}
                  {c.gauge_code && ` · ${c.gauge_code}`}
                  {last && <> · {t('qm.last')}: <span className={last.result === 'nok' ? 'text-rose-600' : 'text-emerald-700'}>{c.kind === 'measure' ? fmt(last.value) : (last.attribute_ok ? 'OK' : 'NOK')}</span></>}
                </div>
              </div>
              {c.kind === 'measure' ? (
                <input className={inputCls} inputMode="decimal" value={vals[c.id] ?? ''} onChange={(e) => setVals({ ...vals, [c.id]: e.target.value })} aria-label={c.name} />
              ) : (
                <div className="flex gap-1">
                  {['ok', 'nok'].map((o) => (
                    <button key={o} type="button" onClick={() => setVals({ ...vals, [c.id]: o })}
                      className={`rounded-lg px-3 ${large ? 'h-12' : 'h-9'} text-sm font-semibold ${vals[c.id] === o ? (o === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white') : 'bg-muted'}`}>{o.toUpperCase()}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" disabled={busy} onClick={submit} className={`rounded-lg bg-accent px-4 font-semibold text-white disabled:opacity-50 ${large ? 'h-12' : 'h-9 text-sm'}`}>{t('qm.save_values')}</button>
    </div>
  );
}
