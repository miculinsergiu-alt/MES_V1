/** Clock in / break / clock out for the logged-in user (shown in the sidebar). */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { LogIn, LogOut, Coffee } from 'lucide-react';
import api from '../api/axios';
import { apiError } from '../lib/format';

const hm = (min) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;

export default function ClockWidget() {
  const { t } = useTranslation();
  const [st, setSt] = useState(null);
  const load = useCallback(() => { api.get('/time/status').then((r) => setSt(r.data)).catch(() => setSt(null)); }, []);
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  if (!st) return null;
  const act = async (path) => {
    try { await api.post(`/time/${path}`); load(); toast.success(t(`time.done.${path}`)); } catch (err) { toast.error(apiError(err, t('time.error'))); }
  };
  const btn = 'flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold';
  return (
    <div className="mb-2 rounded-lg border border-border bg-white p-2">
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{st.clocked_in ? (st.on_break ? t('time.on_break') : t('time.present')) : t('time.absent')}</span>
        {st.entry && <span className="font-mono">{hm(st.entry.worked_minutes)} h</span>}
      </div>
      <div className="flex gap-1">
        {!st.clocked_in && <button type="button" onClick={() => act('clock-in')} className={`${btn} bg-emerald-600 text-white`}><LogIn size={12} />{t('time.clock_in')}</button>}
        {st.clocked_in && <button type="button" onClick={() => act('break')} className={`${btn} bg-muted`}><Coffee size={12} />{st.on_break ? t('time.break_end') : t('time.break')}</button>}
        {st.clocked_in && <button type="button" onClick={() => act('clock-out')} className={`${btn} bg-slate-700 text-white`}><LogOut size={12} />{t('time.clock_out')}</button>}
      </div>
    </div>
  );
}
