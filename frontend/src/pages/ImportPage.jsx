import { hasAnyRole } from '../lib/roles';
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useAuth } from '../contexts/AuthContext';
import { apiError, downloadFile } from '../lib/format';

// Mirrors backend/routes/import.js
const TYPES = {
  items: ['administrator', 'planner'],
  boms: ['administrator', 'planner'],
  customers: ['administrator', 'sales', 'accounting'],
  suppliers: ['administrator', 'planner', 'material_planner'],
  stock: ['administrator', 'planner', 'warehouse_manager'],
};
const MAX_SHOWN = 200;

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function ImportPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const allowed = Object.keys(TYPES).filter((k) => hasAnyRole(user, TYPES[k]));
  const [type, setType] = useState(allowed[0]);
  const [file, setFile] = useState(null); // { name, base64 }
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef(null);

  const reset = (nextType = type) => { setType(nextType); setFile(null); setPreview(null); setMapping({}); setResult(null); };

  const runPreview = async (f, map) => {
    setBusy(true);
    try {
      const res = await api.post(`/import/${type}/preview`, { filename: f.name, content_base64: f.base64, mapping: map });
      setPreview(res.data);
      setMapping(res.data.mapping);
    } catch (err) {
      toast.error(apiError(err, 'Error'), { duration: 8000 });
      setPreview(null);
    } finally { setBusy(false); }
  };

  const onFile = async (f) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast.error('> 10 MB'); return; }
    const next = { name: f.name, base64: await toBase64(f) };
    setFile(next);
    setResult(null);
    runPreview(next, undefined);
  };

  const changeMapping = (key, header) => {
    const next = { ...mapping };
    if (header) next[key] = header; else delete next[key];
    // Unmapping an auto-detected column must be sent explicitly, so send the full mapping.
    setMapping(next);
    runPreview(file, Object.fromEntries(preview.fields.map((f) => [f.key, next[f.key] || '__none__'])));
  };

  const run = async () => {
    setBusy(true);
    try {
      const map = Object.fromEntries(preview.fields.map((f) => [f.key, mapping[f.key] || '__none__']));
      const res = await api.post(`/import/${type}`, { filename: file.name, content_base64: file.base64, mapping: map });
      setResult(res.data);
      setPreview(null);
      toast.success(t('shell.import.done', { created: res.data.created, updated: res.data.updated }));
    } catch (err) { toast.error(apiError(err, 'Error'), { duration: 8000 }); } finally { setBusy(false); }
  };

  if (!allowed.length) return null;
  const cols = preview ? preview.fields.filter((f) => mapping[f.key]) : [];

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <h1 className="font-display text-3xl">{t('shell.import.title')}</h1>
        <p className="text-muted-foreground">{t('shell.import.subtitle')}</p>
      </header>

      <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1" role="tablist">
        {allowed.map((k) => (
          <button key={k} role="tab" aria-selected={type === k} onClick={() => reset(k)}
            className={`rounded-lg px-3 py-1.5 text-sm ${type === k ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {t(`shell.import.types.${k}`)}
          </button>
        ))}
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t(`shell.import.hints.${type}`)}</p>
          <Button size="sm" variant="secondary" onClick={() => downloadFile(`/import/${type}/template`, `NOVA_Import_${type}.xlsx`).catch(() => {})}>
            <Download size={14} className="mr-1" />{t('shell.import.template')}
          </Button>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files[0]); }}
          className={`rounded-2xl border-2 border-dashed p-6 text-center ${dragOver ? 'border-accent bg-accent/5' : 'border-border'}`}
        >
          <input ref={input} type="file" hidden accept=".xlsx,.xls,.ods,.csv,.txt" onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
          <Button size="sm" onClick={() => input.current?.click()} disabled={busy}><Upload size={14} className="mr-1" />{t('shell.import.choose')}</Button>
          <p className="mt-2 text-sm text-muted-foreground">{file ? file.name : t('shell.import.drop')}</p>
        </div>
      </Card>

      {result && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-emerald-300 bg-emerald-50">
          <span className="flex items-center gap-2 font-semibold text-emerald-800"><CheckCircle2 size={18} />{t('shell.import.done', { created: result.created, updated: result.updated })}</span>
          <Button size="sm" variant="secondary" onClick={() => reset()}>{t('shell.import.again')}</Button>
        </Card>
      )}

      {preview && (
        <>
          <Card className="space-y-3">
            <h2 className="font-semibold">{t('shell.import.columns')}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {preview.fields.map((f) => (
                <label key={f.key} className="block space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.key}{f.required && ` (${t('shell.import.required')})`}</span>
                  <select className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm" value={mapping[f.key] || ''} onChange={(e) => changeMapping(f.key, e.target.value)} disabled={busy}>
                    <option value="">{t('shell.import.not_mapped')}</option>
                    {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {preview.missing_columns.length > 0 && (
              <p className="flex items-center gap-2 text-sm font-semibold text-rose-700"><AlertCircle size={16} />{t('shell.import.missing', { fields: preview.missing_columns.join(', ') })}</p>
            )}
          </Card>

          <Card className="space-y-3 p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex gap-4 text-sm">
                <span className="font-semibold text-emerald-700">{t('shell.import.valid', { count: preview.valid_count })}</span>
                {preview.error_count > 0 && <span className="font-semibold text-rose-700">{t('shell.import.errors', { count: preview.error_count })}</span>}
              </div>
              <Button size="sm" onClick={run} disabled={busy || preview.error_count > 0 || preview.missing_columns.length > 0 || !preview.valid_count}>
                {t('shell.import.run', { count: preview.valid_count })}
              </Button>
            </div>
            <div className="max-h-[60vh] overflow-auto border-t border-border">
              <table>
                <thead className="sticky top-0 bg-white">
                  <tr><th>{t('shell.import.row')}</th>{cols.map((f) => <th key={f.key}>{f.key}</th>)}<th>{t('shell.import.problems')}</th></tr>
                </thead>
                <tbody>
                  {[...preview.rows].sort((a, b) => (b.errors.length > 0) - (a.errors.length > 0)).slice(0, MAX_SHOWN).map((r) => (
                    <tr key={r.row} className={r.errors.length ? 'bg-rose-50' : ''}>
                      <td className="font-mono text-xs text-muted-foreground">{r.row}</td>
                      {cols.map((f) => <td key={f.key} className="text-sm">{r.data[f.key] ?? ''}</td>)}
                      <td className="text-xs">{r.errors.length ? <span className="text-rose-700">{r.errors.join('; ')}</span> : <span className="text-emerald-700">{t('shell.import.ok')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > MAX_SHOWN && <p className="p-3 text-xs text-muted-foreground">{t('shell.import.shown', { count: MAX_SHOWN })}</p>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
