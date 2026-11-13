import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BellRing, FileDown } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { eur, dateDE, apiError, downloadFile, todayISO } from '../../lib/format';
import { PageHeader } from './components';

/** Open invoices with overdue days. */
export function OpenItemsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get('/sales/open-items').then((r) => setRows(r.data)).catch((err) => toast.error(apiError(err, t('sales.messages.error')))); }, [t]);
  const total = rows.reduce((s, r) => s + r.open_amount, 0);
  const overdue = rows.filter((r) => r.days_overdue > 0).reduce((s, r) => s + r.open_amount, 0);

  return (
    <div>
      <PageHeader title={t('sales.open_items.title')} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card><div className="text-sm text-muted-foreground">{t('sales.open_items.total')}</div><div className="text-2xl font-bold tabular-nums">{eur(total)}</div></Card>
        <Card><div className="text-sm text-muted-foreground">{t('sales.open_items.overdue')}</div><div className="text-2xl font-bold tabular-nums text-rose-700">{eur(overdue)}</div></Card>
      </div>
      <div className="table-container overflow-x-auto">
        <table>
          <thead><tr><th>{t('sales.fields.number')}</th><th>{t('sales.fields.customer')}</th><th>{t('sales.fields.date')}</th><th>{t('sales.fields.due')}</th><th className="text-right">{t('sales.fields.gross')}</th><th className="text-right">{t('sales.fields.open')}</th><th className="text-right">{t('sales.fields.days_overdue')}</th><th>{t('sales.fields.level')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/sales/documents/${r.id}`)}>
                <td className="font-mono text-sm">{r.number}</td>
                <td>{r.customer_name}</td>
                <td>{dateDE(r.document_date)}</td>
                <td>{dateDE(r.due_date)}</td>
                <td className="text-right tabular-nums">{eur(r.gross_total)}</td>
                <td className="text-right font-semibold tabular-nums">{eur(r.open_amount)}</td>
                <td className={`text-right tabular-nums ${r.days_overdue > 0 ? 'font-semibold text-rose-700' : ''}`}>{r.days_overdue || '—'}</td>
                <td>{r.dunning_level ? t(`sales.dunning.levels.${r.dunning_level}`) : '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">{t('sales.open_items.none')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Invoices due for their next payment reminder. */
export function DunningPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const load = useCallback(() => api.get('/sales/dunning/proposals').then((r) => setRows(r.data)).catch((err) => toast.error(apiError(err, t('sales.messages.error')))), [t]);
  useEffect(() => { load(); }, [load]);

  const send = async (row) => {
    try {
      await api.post(`/sales/${row.id}/dunning`, {});
      toast.success(t('sales.dunning.sent'));
      load();
    } catch (err) { toast.error(apiError(err, t('sales.messages.error'))); }
  };

  return (
    <div>
      <PageHeader title={t('sales.dunning.title')} />
      <h2 className="mb-3 font-semibold">{t('sales.dunning.proposals')}</h2>
      <div className="table-container overflow-x-auto">
        <table>
          <thead><tr><th>{t('sales.fields.number')}</th><th>{t('sales.fields.customer')}</th><th>{t('sales.fields.due')}</th><th className="text-right">{t('sales.fields.open')}</th><th className="text-right">{t('sales.fields.days_overdue')}</th><th>{t('sales.fields.level')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-sm"><button className="text-accent hover:underline" onClick={() => navigate(`/sales/documents/${r.id}`)}>{r.number}</button></td>
                <td>{r.customer_name}</td>
                <td>{dateDE(r.due_date)}</td>
                <td className="text-right tabular-nums">{eur(r.open_amount)}</td>
                <td className="text-right tabular-nums text-rose-700">{r.days_overdue}</td>
                <td>{t(`sales.dunning.levels.${r.next_level}`)}</td>
                <td className="text-right"><Button size="sm" variant="secondary" onClick={() => send(r)}><BellRing size={14} className="mr-1" />{t('sales.actions.send_reminder')}</Button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">{t('sales.dunning.none')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** DATEV Buchungsstapel download. */
export function DatevPage() {
  const { t } = useTranslation();
  const today = todayISO();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const inputCls = 'h-10 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

  const run = async () => {
    setBusy(true);
    try { await downloadFile(`/datev/export?from=${from}&to=${to}`, `EXTF_Buchungsstapel_${from}_${to}.csv`); } catch (err) {
      // Blob error responses must be read before the message is available.
      let msg = t('sales.messages.error');
      try { msg = JSON.parse(await err.response.data.text()).error || msg; } catch { /* keep default */ }
      toast.error(msg, { duration: 8000 });
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title={t('sales.datev.title')} />
      <Card className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('sales.datev.hint')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1"><span className="block text-xs font-semibold uppercase text-muted-foreground">{t('sales.datev.from')}</span><input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="space-y-1"><span className="block text-xs font-semibold uppercase text-muted-foreground">{t('sales.datev.to')}</span><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <Button size="sm" onClick={run} disabled={busy}><FileDown size={14} className="mr-1" />{t('sales.actions.export')}</Button>
        </div>
      </Card>
    </div>
  );
}
