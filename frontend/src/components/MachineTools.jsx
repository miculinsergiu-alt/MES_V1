/** Tools at the operator's machine that are near end of life, with "replaced" button. */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Wrench } from 'lucide-react';
import api from '../api/axios';
import { apiError } from '../lib/format';

export default function MachineTools({ machineId }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const load = useCallback(() => { api.get('/tools', { params: { machine_id: machineId } }).then((r) => setRows(r.data.filter((x) => x.worn))).catch(() => {}); }, [machineId]);
  useEffect(() => { load(); }, [load]);
  if (!rows.length) return null;
  const replace = async (tool, kind) => { try { await api.post(`/tools/${tool.id}/replace`, { kind }); toast.success(t('tools.done')); load(); } catch (err) { toast.error(apiError(err, t('tools.error'))); } };
  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
      {rows.map((x) => (
        <div key={x.id} className="flex flex-wrap items-center gap-2 text-sm text-amber-900">
          <Wrench size={16} />
          <span className="flex-1">{t('tools.worn_msg', { code: x.code, name: x.name, used: x.used_parts, life: x.life_limit_parts })}</span>
          <button type="button" onClick={() => replace(x, 'replaced')} className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">{t('tools.replace')}</button>
          <button type="button" onClick={() => replace(x, 'regrind')} className="rounded border border-amber-600 px-3 py-1.5 text-xs font-semibold">{t('tools.regrind')}</button>
        </div>
      ))}
    </div>
  );
}
