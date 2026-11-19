/**
 * Files on a record: material certificates, drawings, NC programs, reports.
 * <Attachments ownerType="lot" ownerId={5} kinds={['certificate']} />
 * Drawings and NC programs ask for a revision index and keep a history.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { FileText, Upload, Trash2, History } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { apiError, openFile, downloadFile } from '../lib/format';

const READ_ONLY_ROLES = ['operator'];
const REVISIONED = ['drawing', 'nc_program'];
const inputCls = 'h-9 rounded-lg border border-border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function Attachments({ ownerType, ownerId, kinds = ['other'], title, compact = false, onChange }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const roles = user?.roles?.length ? user.roles : [user?.role];
  const canWrite = roles.some((r) => !READ_ONLY_ROLES.includes(r));
  const [rows, setRows] = useState([]);
  const [history, setHistory] = useState(false);
  const [kind, setKind] = useState(kinds[0]);
  const [revision, setRevision] = useState('');
  const [certType, setCertType] = useState('3.1');
  const [heat, setHeat] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!ownerId) return;
    const res = await api.get('/attachments', { params: { owner_type: ownerType, owner_id: ownerId, all_revisions: history ? 1 : undefined } });
    setRows(res.data.filter((r) => kinds.includes(r.kind)));
  }, [ownerType, ownerId, history, kinds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load().catch(() => {}); }, [load]);

  const upload = async (files) => {
    if (!files.length) return;
    if (REVISIONED.includes(kind) && !revision.trim()) { toast.error(t('files.revision_required')); return; }
    setBusy(true);
    try {
      for (const file of files) {
        await api.post('/attachments', {
          owner_type: ownerType, owner_id: ownerId, kind, filename: file.name, mime_type: file.type || undefined,
          content_base64: await readAsBase64(file),
          revision: REVISIONED.includes(kind) ? revision.trim() : undefined,
          cert_type: kind === 'certificate' ? certType : undefined,
          heat_number: kind === 'certificate' && heat.trim() ? heat.trim() : undefined,
        });
      }
      toast.success(t('files.uploaded'));
      setRevision(''); setHeat('');
      await load();
      onChange?.();
    } catch (err) { toast.error(apiError(err, t('files.error'))); } finally { setBusy(false); }
  };

  const remove = async (row) => {
    try { await api.delete(`/attachments/${row.id}`); await load(); onChange?.(); } catch (err) { toast.error(apiError(err, t('files.error'))); }
  };

  const open = (row) => {
    const url = `/attachments/${row.id}/file`;
    (/^(application\/pdf|image\/)/.test(row.mime_type) ? openFile(url) : downloadFile(url, row.filename)).catch((err) => toast.error(apiError(err, t('files.error'))));
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3 rounded-xl border border-border bg-white p-4'}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title || t(`files.kinds_plural.${kinds[0]}`)}</h3>
        {kinds.some((k) => REVISIONED.includes(k)) && (
          <button type="button" onClick={() => setHistory((x) => !x)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <History size={12} /> {history ? t('files.hide_history') : t('files.show_history')}
          </button>
        )}
      </div>

      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('files.none')}</p>}
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className={`flex items-center gap-2 py-2 text-sm ${r.is_current ? '' : 'opacity-60'}`}>
            <FileText size={16} className="shrink-0 text-muted-foreground" />
            <button type="button" onClick={() => open(r)} className="min-w-0 flex-1 truncate text-left text-accent hover:underline">{r.filename}</button>
            {r.revision && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{t('files.rev')} {r.revision}{!r.is_current && ` · ${t('files.old')}`}</span>}
            {r.cert_type && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">{r.cert_type}{r.heat_number ? ` · ${r.heat_number}` : ''}</span>}
            {kinds.length > 1 && <span className="text-xs text-muted-foreground">{t(`files.kinds.${r.kind}`)}</span>}
            <span className="hidden text-xs text-muted-foreground sm:inline">{kb(r.size_bytes)}</span>
            {canWrite && <button type="button" onClick={() => remove(r)} title={t('files.delete')} className="text-muted-foreground hover:text-rose-600"><Trash2 size={14} /></button>}
          </li>
        ))}
      </ul>

      {canWrite && ownerId && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          {kinds.length > 1 && (
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('files.kind')}>
              {kinds.map((k) => <option key={k} value={k}>{t(`files.kinds.${k}`)}</option>)}
            </select>
          )}
          {REVISIONED.includes(kind) && (
            <input className={`${inputCls} w-24`} placeholder={t('files.revision')} value={revision} onChange={(e) => setRevision(e.target.value)} maxLength={20} />
          )}
          {kind === 'certificate' && (
            <>
              <select className={inputCls} value={certType} onChange={(e) => setCertType(e.target.value)} aria-label="EN 10204">
                {['2.1', '2.2', '3.1', '3.2'].map((x) => <option key={x} value={x}>EN 10204 {x}</option>)}
              </select>
              <input className={`${inputCls} w-36`} placeholder={t('files.heat_number')} value={heat} onChange={(e) => setHeat(e.target.value)} maxLength={100} />
            </>
          )}
          <input ref={fileRef} type="file" hidden multiple onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
            className="flex h-9 items-center gap-1 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            <Upload size={14} /> {t('files.upload')}
          </button>
        </div>
      )}
    </div>
  );
}
