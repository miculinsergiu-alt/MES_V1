/**
 * Vorkalkulation dialog: price tiers for an item from BOM + routing + rates.
 * "Use" saves the calculation and hands back { calculation_id, quantity, price_per_piece }.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { X, Calculator } from 'lucide-react';
import api from '../api/axios';
import { eur, apiError } from '../lib/format';

const inputCls = 'h-9 w-20 rounded-lg border border-border bg-white px-2 text-right text-sm';

export default function CalcDialog({ itemId, quantity, customerId, onUse, onClose }) {
  const { t } = useTranslation();
  const [input, setInput] = useState(null);
  const [rates, setRates] = useState(null);
  const [qtys, setQtys] = useState(() => [...new Set([Number(quantity) || 1, 10, 50, 100].filter((x) => x > 0))].sort((a, b) => a - b).join(', '));
  const [extra, setExtra] = useState(0);
  const [tiers, setTiers] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/quote-calc/inputs/${itemId}`).then((r) => { setInput(r.data); setRates(r.data.rates); })
      .catch((err) => toast.error(apiError(err, t('calc.error'))));
  }, [itemId, t]);

  const quantities = () => qtys.split(/[;,\s]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => x > 0).slice(0, 10);
  const body = () => ({ item_id: itemId, quantities: quantities(), extra_per_batch: Number(extra) || 0, overrides: { rates } });

  const run = async () => {
    if (!quantities().length) return;
    setBusy(true);
    try { setTiers((await api.post('/quote-calc/preview', body())).data.tiers); } catch (err) { toast.error(apiError(err, t('calc.error'))); } finally { setBusy(false); }
  };
  useEffect(() => { if (rates) run(); }, [rates]); // eslint-disable-line react-hooks/exhaustive-deps

  const use = async (tier) => {
    setBusy(true);
    try {
      const saved = (await api.post('/quote-calc', { ...body(), customer_id: customerId || undefined })).data;
      const chosen = saved.tiers.find((x) => x.quantity === tier.quantity) || tier;
      onUse({ calculation_id: saved.id, quantity: chosen.quantity, price_per_piece: chosen.price_per_piece });
    } catch (err) { toast.error(apiError(err, t('calc.error'))); } finally { setBusy(false); }
  };

  const rows = [
    ['material', 'calc.material'], ['material_surcharge', 'calc.material_surcharge'], ['machine', 'calc.machine'], ['labour', 'calc.labour'],
    ['external', 'calc.external'], ['extra', 'calc.extra'], ['overhead', 'calc.overhead'], ['cost', 'calc.cost'], ['margin', 'calc.margin'], ['net', 'calc.net'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl"><Calculator size={20} />{t('calc.title')}</h2>
            {input && <p className="text-sm text-muted-foreground">{input.item.item_code} · {input.item.name}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="close" className="rounded p-2 hover:bg-muted"><X size={18} /></button>
        </div>

        {input?.warnings?.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {input.warnings.map((w) => <div key={w}>{t(`calc.warn.${w}`)}</div>)}
          </div>
        )}

        {rates && (
          <div className="mb-4 flex flex-wrap items-end gap-3 text-sm">
            <label className="flex-1 min-w-[12rem]">{t('calc.quantities')}<br />
              <input className="h-9 w-full rounded-lg border border-border px-2" value={qtys} onChange={(e) => setQtys(e.target.value)} onBlur={run} /></label>
            {[['labor_rate', '€/h'], ['material_surcharge', '%'], ['overhead', '%'], ['margin', '%']].map(([k, unit]) => (
              <label key={k}>{t(`calc.rate.${k}`)} ({unit})<br />
                <input type="number" min="0" step="0.5" className={inputCls} value={rates[k]} onChange={(e) => setRates({ ...rates, [k]: Number(e.target.value) })} /></label>
            ))}
            <label>{t('calc.extra')} (€)<br />
              <input type="number" min="0" step="1" className={inputCls} value={extra} onChange={(e) => setExtra(e.target.value)} onBlur={run} /></label>
          </div>
        )}

        {tiers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                  <th className="py-2 text-left">{t('calc.quantity')}</th>
                  {tiers.map((x) => <th key={x.quantity} className="py-2 text-right">{x.quantity}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.filter(([k]) => tiers.some((x) => x[k])).map(([k, label]) => (
                  <tr key={k} className={`border-b border-border/60 ${['cost', 'net'].includes(k) ? 'font-semibold' : ''}`}>
                    <td className="py-1.5">{t(label)}</td>
                    {tiers.map((x) => <td key={x.quantity} className="py-1.5 text-right tabular-nums">{eur(x[k])}</td>)}
                  </tr>
                ))}
                <tr className="text-base font-bold">
                  <td className="py-2">{t('calc.price_per_piece')}</td>
                  {tiers.map((x) => <td key={x.quantity} className="py-2 text-right tabular-nums text-accent">{eur(x.price_per_piece)}</td>)}
                </tr>
                <tr>
                  <td />
                  {tiers.map((x) => (
                    <td key={x.quantity} className="pt-2 text-right">
                      <button type="button" disabled={busy} onClick={() => use(x)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{t('calc.use')}</button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">{t('calc.hint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
