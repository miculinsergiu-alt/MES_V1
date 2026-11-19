/**
 * One routing step: on one of our machines (setup + time per piece) or at a
 * subcontractor (outside processing: supplier, days, price per piece, minimum charge).
 */
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';

const cls = 'h-10 w-full rounded-lg border border-border bg-white px-2 text-sm outline-none focus:ring-1 ring-accent';
const Label = ({ children }) => <span className="block text-[10px] font-bold uppercase text-muted-foreground">{children}</span>;
const num = (x) => (x === '' || x === null || x === undefined ? 0 : Number(x));

/** Clean payload for the API (drops display-only fields and the other step type's values). */
export function routeForApi(r) {
  const ext = r.step_type === 'external';
  return ext
    ? { step_type: 'external', supplier_id: Number(r.supplier_id) || undefined, external_days: num(r.external_days), external_price: num(r.external_price), external_min_charge: num(r.external_min_charge), notes: r.notes || '' }
    : { step_type: 'internal', machine_id: Number(r.machine_id) || undefined, process_time_min: num(r.process_time_min), setup_time_min: num(r.setup_time_min), notes: r.notes || '' };
}

export default function RouteStepEditor({ index, step, machines, suppliers, onChange, onRemove, first }) {
  const { t } = useTranslation();
  const set = (patch) => onChange({ ...step, ...patch });
  const ext = step.step_type === 'external';
  return (
    <div className={`rounded-xl border p-3 shadow-sm ${ext ? 'border-amber-300 bg-amber-50/40' : 'border-border bg-white'}`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-10 text-center font-black text-accent">{index + 1}</div>
        <label className="w-36 space-y-1">
          <Label>{t('sub.step_type')}</Label>
          <select className={cls} value={step.step_type || 'internal'} disabled={first}
            onChange={(e) => set({ step_type: e.target.value, machine_id: step.machine_id || machines[0]?.id, supplier_id: step.supplier_id || suppliers[0]?.id })}>
            <option value="internal">{t('sub.internal')}</option>
            <option value="external">{t('sub.external')}</option>
          </select>
        </label>
        {!ext ? (
          <>
            <label className="min-w-[10rem] flex-1 space-y-1">
              <Label>{t('admin.machine_name')}</Label>
              <select className={cls} value={step.machine_id || ''} onChange={(e) => set({ machine_id: Number(e.target.value) })}>
                {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="w-24 space-y-1"><Label>{t('sub.setup_min')}</Label>
              <input type="number" min="0" className={`${cls} font-mono`} value={step.setup_time_min ?? 0} onChange={(e) => set({ setup_time_min: e.target.value })} /></label>
            <label className="w-24 space-y-1"><Label>{t('sub.min_per_piece')}</Label>
              <input type="number" min="0" step="0.1" className={`${cls} font-mono`} value={step.process_time_min ?? 0} onChange={(e) => set({ process_time_min: e.target.value })} /></label>
          </>
        ) : (
          <>
            <label className="min-w-[10rem] flex-1 space-y-1">
              <Label>{t('sub.subcontractor')}</Label>
              <select className={cls} value={step.supplier_id || ''} onChange={(e) => set({ supplier_id: Number(e.target.value) })}>
                {!suppliers.length && <option value="">{t('sub.no_suppliers')}</option>}
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="w-20 space-y-1"><Label>{t('sub.days')}</Label>
              <input type="number" min="0" className={`${cls} font-mono`} value={step.external_days ?? 0} onChange={(e) => set({ external_days: e.target.value })} /></label>
            <label className="w-24 space-y-1"><Label>{t('sub.price_piece')}</Label>
              <input type="number" min="0" step="0.01" className={`${cls} font-mono`} value={step.external_price ?? 0} onChange={(e) => set({ external_price: e.target.value })} /></label>
            <label className="w-24 space-y-1"><Label>{t('sub.min_charge')}</Label>
              <input type="number" min="0" step="0.01" className={`${cls} font-mono`} value={step.external_min_charge ?? 0} onChange={(e) => set({ external_min_charge: e.target.value })} /></label>
          </>
        )}
        <button type="button" onClick={onRemove} className="flex h-10 items-center px-2 text-red-500 hover:bg-red-50 rounded-lg" aria-label="remove"><Trash2 size={16} /></button>
      </div>
      <input className={`${cls} mt-2 h-9`} placeholder={ext ? t('sub.operation_placeholder') : t('sub.notes')} value={step.notes || ''} onChange={(e) => set({ notes: e.target.value })} maxLength={1000} />
    </div>
  );
}
