/**
 * Working time: own entries for everyone; monthly report, CSV export and
 * corrections for supervisors / accounting.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Download, Plus } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../sales/components';
import { apiError, downloadFile } from '../../lib/format';

const MANAGERS = ['administrator', 'area_supervisor', 'shift_responsible', 'accounting'];
const cls = 'h-9 rounded-lg border border-border bg-white px-2 text-sm';
const hm = (min) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const n = (x) => (x === null || x === undefined ? '-' : Number(x).toLocaleString(undefined, { maximumFractionDigits: 2 }));

function Entries({ userId, canEdit, t }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);
  const load = useCallback(() => { api.get('/time/entries', { params: { user_id: userId } }).then((r) => setRows(r.data)).catch(() => {}); }, [userId]);
  useEffect(() => { load(); }, [load]);
  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { clock_in: form.clock_in.replace('T', ' '), clock_out: form.clock_out ? form.clock_out.replace('T', ' ') : undefined, break_minutes: Number(form.break_minutes) || 0, note: form.note };
      if (form.id) await api.put(`/time/entries/${form.id}`, body); else await api.post('/time/entries', { ...body, user_id: userId });
      setForm(null); load();
    } catch (err) { toast.error(apiError(err, t('time.error'))); }
  };
  return (
    <div className="space-y-2">
      {canEdit && <Button size="sm" variant="secondary" onClick={() => setForm({ clock_in: '', clock_out: '', break_minutes: 30, note: '' })}><Plus size={14} className="mr-1" />{t('time.add_entry')}</Button>}
      {form && (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/40 p-3 text-xs">
          <label>{t('time.in')}<br /><input type="datetime-local" required className={cls} value={form.clock_in} onChange={(e) => setForm({ ...form, clock_in: e.target.value })} /></label>
          <label>{t('time.out')}<br /><input type="datetime-local" className={cls} value={form.clock_out} onChange={(e) => setForm({ ...form, clock_out: e.target.value })} /></label>
          <label>{t('time.break_min')}<br /><input type="number" min="0" className={`${cls} w-20`} value={form.break_minutes} onChange={(e) => setForm({ ...form, break_minutes: e.target.value })} /></label>
          <label className="min-w-[12rem] flex-1">{t('time.reason')}<br /><input required minLength={3} className={`${cls} w-full`} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <Button size="sm" type="submit">{t('time.save')}</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setForm(null)}>✕</Button>
        </form>
      )}
      <div className="table-container overflow-x-auto">
        <table>
          <thead><tr><th>{t('time.in')}</th><th>{t('time.out')}</th><th className="text-right">{t('time.break_min')}</th><th className="text-right">{t('time.worked')}</th><th>{t('time.notes')}</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.over_10h ? 'bg-rose-50' : ''}>
                <td className="font-mono">{String(r.clock_in).slice(0, 16)}</td>
                <td className="font-mono">{r.clock_out ? String(r.clock_out).slice(0, 16) : <span className="text-emerald-700">{t('time.present')}</span>}</td>
                <td className="text-right">{r.break_applied}{r.statutory_break_added && ' *'}</td>
                <td className="text-right font-mono">{hm(r.worked_minutes)}</td>
                <td className="text-xs text-muted-foreground">{r.note || ''}{r.corrected_by ? ` (${t('time.corrected')})` : ''}</td>
                {canEdit && <td><button type="button" className="text-xs text-accent" onClick={() => setForm({ id: r.id, clock_in: String(r.clock_in).slice(0, 16).replace(' ', 'T'), clock_out: r.clock_out ? String(r.clock_out).slice(0, 16).replace(' ', 'T') : '', break_minutes: r.break_minutes, note: '' })}>{t('time.correct')}</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t('time.break_hint')}</p>
    </div>
  );
}

export default function TimePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const roles = user?.roles?.length ? user.roles : [user?.role];
  const manager = roles.some((r) => MANAGERS.includes(r));
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (manager) api.get('/time/report', { params: { month } }).then((r) => setReport(r.data)).catch((err) => toast.error(apiError(err, t('time.error'))));
  }, [manager, month, t]);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title={t('shell.nav.time')}>
        {manager && (
          <>
            <input type="month" className={cls} value={month} onChange={(e) => setMonth(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={() => downloadFile(`/time/report?month=${month}&format=csv`, `Arbeitszeit_${month}.csv`).catch(() => {})}><Download size={14} className="mr-1" />CSV</Button>
          </>
        )}
      </PageHeader>

      {manager && report && (
        <div className="table-container overflow-x-auto">
          <table>
            <thead><tr><th>{t('time.employee')}</th><th className="text-right">{t('time.days')}</th><th className="text-right">{t('time.hours')}</th><th className="text-right">{t('time.target')}</th><th className="text-right">{t('time.overtime')}</th><th className="text-right">{t('time.productive')}</th><th className="text-right">&gt;10h</th></tr></thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.user_id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(r)}>
                  <td>{r.name} <span className="text-xs text-muted-foreground">{r.badge_number}</span>{r.open_entries > 0 && <span className="ml-1 text-xs text-emerald-700">●</span>}</td>
                  <td className="text-right">{r.days}</td><td className="text-right font-mono">{n(r.hours)}</td><td className="text-right font-mono">{n(r.target_hours)}</td>
                  <td className={`text-right font-mono ${r.overtime_hours < 0 ? 'text-rose-600' : ''}`}>{n(r.overtime_hours)}</td>
                  <td className="text-right font-mono">{n(r.productive_hours)}{r.productivity_percent !== null && <span className="text-xs text-muted-foreground"> ({n(r.productivity_percent)} %)</span>}</td>
                  <td className={`text-right ${r.over_10h_days ? 'font-semibold text-rose-600' : ''}`}>{r.over_10h_days}</td>
                </tr>
              ))}
              {!report.rows.length && <tr><td colSpan={7} className="text-center text-sm text-muted-foreground">{t('time.no_entries')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <Card className="space-y-3">
        <h2 className="font-semibold">{selected ? selected.name : t('time.my_times')}</h2>
        <Entries key={selected?.user_id || 'me'} userId={selected?.user_id || user.id} canEdit={manager} t={t} />
      </Card>
    </div>
  );
}
