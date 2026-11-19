/**
 * Outside processing (Fremdbearbeitung): jobs at subcontractors.
 * Planned -> send (purchase order + delivery note) -> receive (good / scrap).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Send, PackageCheck, FileText, X } from 'lucide-react';
import api from '../../api/axios';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../sales/components';
import { eur, num, dateDE, apiError, openFile } from '../../lib/format';

const STATUS_CLS = { planned: 'bg-slate-100 text-slate-700', sent: 'bg-amber-50 text-amber-700', received: 'bg-emerald-50 text-emerald-700', cancelled: 'bg-rose-50 text-rose-700' };
const inputCls = 'h-9 w-28 rounded-lg border border-border bg-white px-2 text-sm';
const FILTERS = ['open', 'received', 'all'];

function ReceiveForm({ job, onDone, t }) {
  const [ok, setOk] = useState(job.sent_quantity ?? job.quantity);
  const [fail, setFail] = useState(0);
  const [cost, setCost] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/subcontracting/${job.id}/receive`, { qty_ok: ok, qty_fail: fail, actual_cost: cost === '' ? undefined : cost });
      toast.success(t('sub.received_ok'));
      onDone();
    } catch (err) { toast.error(apiError(err, t('sub.error'))); }
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-muted/40 p-3 text-sm">
      <label>{t('sub.qty_ok')}<br /><input type="number" min="0" step="any" className={inputCls} value={ok} onChange={(e) => setOk(e.target.value)} /></label>
      <label>{t('sub.qty_fail')}<br /><input type="number" min="0" step="any" className={inputCls} value={fail} onChange={(e) => setFail(e.target.value)} /></label>
      <label>{t('sub.actual_cost')}<br /><input type="number" min="0" step="0.01" placeholder={num(job.planned_cost)} className={inputCls} value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      <Button size="sm" type="submit"><PackageCheck size={14} className="mr-1" />{t('sub.receive')}</Button>
    </form>
  );
}

export default function SubcontractingPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('open');
  const [rows, setRows] = useState([]);
  const [receiving, setReceiving] = useState(null);

  const load = useCallback(() => {
    api.get('/subcontracting', { params: { status: filter === 'all' ? undefined : filter } })
      .then((r) => setRows(r.data)).catch((err) => toast.error(apiError(err, t('sub.error'))));
  }, [filter, t]);
  useEffect(() => { load(); }, [load]);

  const act = async (job, action) => {
    try {
      await api.post(`/subcontracting/${job.id}/${action}`, {});
      if (action === 'send') {
        toast.success(t('sub.sent_ok'));
        openFile(`/subcontracting/${job.id}/delivery-note.pdf`).catch(() => {});
      }
      load();
    } catch (err) { toast.error(apiError(err, t('sub.error'))); }
  };

  return (
    <div className="max-w-6xl">
      <PageHeader title={t('shell.nav.subcontracting')}>
        <div className="flex rounded-lg border border-border bg-white p-1 text-sm">
          {FILTERS.map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-md px-3 py-1 ${filter === f ? 'bg-accent text-white' : 'text-muted-foreground'}`}>{t(`sub.filter.${f}`)}</button>
          ))}
        </div>
      </PageHeader>
      <p className="mb-4 text-sm text-muted-foreground">{t('sub.intro')}</p>

      {rows.length === 0 && <Card><p className="text-sm text-muted-foreground">{t('sub.empty')}</p></Card>}
      <div className="space-y-3">
        {rows.map((j) => {
          const late = j.status === 'sent' && j.planned_return && new Date(j.planned_return.replace(' ', 'T')) < new Date();
          return (
            <Card key={j.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[j.status]}`}>{t(`sub.status.${j.status}`)}</span>
                    {late && <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">{t('sub.late')}</span>}
                    <span className="font-semibold">{j.description}</span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {j.supplier_name} · {[j.item_code, j.item_name].filter(Boolean).join(' ') || j.product_name} · {t('sub.order')} #{j.order_id}
                  </div>
                  <div className="mt-1 text-sm">
                    {num(j.sent_quantity ?? j.quantity)} {j.uom || ''} · {t('sub.planned_cost')}: {eur(j.planned_cost)}
                    {j.status === 'received' && <> · {t('sub.qty_ok')}: {num(j.received_ok)} / {t('sub.qty_fail')}: {num(j.received_fail)} · {eur(j.actual_cost)}</>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {j.status === 'planned' && <>{t('sub.planned_send')}: {dateDE(j.planned_send)} · </>}
                    {t('sub.planned_return')}: {dateDE(j.planned_return)}
                    {j.delivery_note_number && <> · {j.delivery_note_number} · {j.po_number}</>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {j.status === 'planned' && <Button size="sm" onClick={() => act(j, 'send')}><Send size={14} className="mr-1" />{t('sub.send')}</Button>}
                  {j.status === 'sent' && <Button size="sm" onClick={() => setReceiving(receiving === j.id ? null : j.id)}><PackageCheck size={14} className="mr-1" />{t('sub.receive')}</Button>}
                  {j.delivery_note_number && <Button size="sm" variant="secondary" onClick={() => openFile(`/subcontracting/${j.id}/delivery-note.pdf`).catch(() => {})}><FileText size={14} className="mr-1" />{t('sub.delivery_note')}</Button>}
                  {['planned', 'sent'].includes(j.status) && <Button size="sm" variant="ghost" title={t('sub.cancel')} onClick={() => act(j, 'cancel')}><X size={14} /></Button>}
                </div>
              </div>
              {receiving === j.id && <ReceiveForm job={j} t={t} onDone={() => { setReceiving(null); load(); }} />}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
