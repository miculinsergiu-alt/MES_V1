/**
 * Tool management: tools, wear (parts used / tool life), spares, replacement log.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, PackagePlus } from 'lucide-react';
import api from '../../api/axios';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../sales/components';
import { apiError } from '../../lib/format';

const cls = 'h-9 rounded-lg border border-border bg-white px-2 text-sm';

export function WearBar({ tool }) {
  if (tool.wear_percent === null) return <span className="text-xs text-muted-foreground">-</span>;
  const p = Math.min(100, tool.wear_percent);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded bg-muted"><div className={`h-2 ${tool.expired ? 'bg-rose-600' : tool.worn ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${p}%` }} /></div>
      <span className="text-xs tabular-nums">{tool.used_parts}/{tool.life_limit_parts}</span>
    </div>
  );
}

export default function ToolsPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [machines, setMachines] = useState([]);
  const [f, setF] = useState({ code: '', name: '', tool_type: '', machine_id: '', life_limit_parts: '', spare_count: 0, min_spares: 0 });
  const load = useCallback(() => { api.get('/tools').then((r) => setRows(r.data)).catch(() => {}); }, []);
  useEffect(() => { load(); api.get('/machines').then((r) => setMachines(Array.isArray(r.data) ? r.data : [])).catch(() => {}); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post('/tools', { ...f, machine_id: f.machine_id ? Number(f.machine_id) : undefined, life_limit_parts: f.life_limit_parts || undefined });
      setF({ code: '', name: '', tool_type: '', machine_id: '', life_limit_parts: '', spare_count: 0, min_spares: 0 }); load();
    } catch (err) { toast.error(apiError(err, t('tools.error'))); }
  };
  const act = async (tool, path, body) => { try { await api.post(`/tools/${tool.id}/${path}`, body); load(); } catch (err) { toast.error(apiError(err, t('tools.error'))); } };
  const mount = async (tool, machineId) => { try { await api.put(`/tools/${tool.id}`, { machine_id: machineId ? Number(machineId) : null }); load(); } catch (err) { toast.error(apiError(err, t('tools.error'))); } };

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={t('shell.nav.tools')} />
      <Card>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-xs">
          <label>{t('tools.code')}<br /><input required className={`${cls} w-28`} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
          <label className="min-w-[12rem] flex-1">{t('tools.name')}<br /><input required className={`${cls} w-full`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>{t('tools.type')}<br /><input className={`${cls} w-28`} value={f.tool_type} onChange={(e) => setF({ ...f, tool_type: e.target.value })} /></label>
          <label>{t('tools.machine')}<br /><select className={cls} value={f.machine_id} onChange={(e) => setF({ ...f, machine_id: e.target.value })}><option value="">{t('tools.store')}</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label>{t('tools.life')}<br /><input type="number" min="1" className={`${cls} w-24`} value={f.life_limit_parts} onChange={(e) => setF({ ...f, life_limit_parts: e.target.value })} /></label>
          <label>{t('tools.spares')}<br /><input type="number" min="0" className={`${cls} w-16`} value={f.spare_count} onChange={(e) => setF({ ...f, spare_count: e.target.value })} /></label>
          <label>{t('tools.min_spares')}<br /><input type="number" min="0" className={`${cls} w-16`} value={f.min_spares} onChange={(e) => setF({ ...f, min_spares: e.target.value })} /></label>
          <Button size="sm" type="submit"><Plus size={14} /></Button>
        </form>
      </Card>
      <div className="table-container overflow-x-auto">
        <table>
          <thead><tr><th>{t('tools.code')}</th><th>{t('tools.name')}</th><th>{t('tools.machine')}</th><th>{t('tools.wear')}</th><th className="text-right">{t('tools.spares')}</th><th /></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td className="font-mono">{x.code}</td>
                <td>{x.name}<div className="text-xs text-muted-foreground">{x.tool_type}</div></td>
                <td><select className="h-8 rounded border border-border px-1 text-xs" value={x.machine_id || ''} onChange={(e) => mount(x, e.target.value)}><option value="">{t('tools.store')}</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></td>
                <td><WearBar tool={x} /></td>
                <td className={`text-right ${x.spares_low ? 'font-semibold text-rose-600' : ''}`}>{x.spare_count}{x.min_spares ? ` / ${x.min_spares}` : ''}</td>
                <td className="whitespace-nowrap text-right">
                  <button type="button" className="mr-2 inline-flex items-center gap-1 text-xs text-accent" onClick={() => act(x, 'replace', { kind: 'replaced' })}><RefreshCw size={12} />{t('tools.replace')}</button>
                  <button type="button" className="mr-2 text-xs text-accent" onClick={() => act(x, 'replace', { kind: 'regrind' })}>{t('tools.regrind')}</button>
                  <button type="button" className="inline-flex items-center gap-1 text-xs text-accent" onClick={() => { const n = Number(window.prompt(t('tools.how_many'), '1')); if (n > 0) act(x, 'spares', { quantity: n }); }}><PackagePlus size={12} />{t('tools.add_spares')}</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="text-center text-sm text-muted-foreground">{t('tools.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t('tools.hint')}</p>
    </div>
  );
}
