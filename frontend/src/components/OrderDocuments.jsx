/**
 * Drawing and NC program of a production order (the revision it was planned
 * with), with a warning when the item has a newer revision.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { FileText, Cpu, AlertTriangle } from 'lucide-react';
import api from '../api/axios';
import { apiError, openFile, downloadFile } from '../lib/format';

export default function OrderDocuments({ orderId, canAdopt = false, large = false }) {
  const { t } = useTranslation();
  const [docs, setDocs] = useState(null);
  const load = useCallback(() => {
    api.get(`/orders/${orderId}/documents`).then((r) => setDocs(r.data)).catch(() => setDocs(null));
  }, [orderId]);
  useEffect(() => { load(); }, [load]);

  if (!docs || (!docs.drawing.file && !docs.nc_program.file)) return null;
  const outdated = docs.drawing.outdated || docs.nc_program.outdated;
  const open = (f) => {
    const url = `/attachments/${f.id}/file`;
    (/^(application\/pdf|image\/)/.test(f.mime_type) ? openFile(url) : downloadFile(url, f.filename)).catch((err) => toast.error(apiError(err, t('files.error'))));
  };
  const adopt = async () => {
    try { await api.post(`/orders/${orderId}/adopt-revision`); load(); } catch (err) { toast.error(apiError(err, t('files.error'))); }
  };
  const btn = large ? 'btn btn-secondary gap-2' : 'inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-sm hover:bg-muted';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {docs.drawing.file && (
          <button type="button" className={btn} onClick={() => open(docs.drawing.file)}>
            <FileText size={large ? 18 : 14} /> {t('files.kinds.drawing')} {t('files.rev')} {docs.drawing.file.revision}
          </button>
        )}
        {docs.nc_program.file && (
          <button type="button" className={btn} onClick={() => open(docs.nc_program.file)}>
            <Cpu size={large ? 18 : 14} /> {t('files.kinds.nc_program')} {docs.nc_program.file.revision}
          </button>
        )}
      </div>
      {outdated && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={16} />
          {t('files.outdated', {
            planned: [docs.drawing.outdated && docs.drawing.file?.revision, docs.nc_program.outdated && docs.nc_program.file?.revision].filter(Boolean).join(' / '),
            current: [docs.drawing.outdated && docs.drawing.current_revision, docs.nc_program.outdated && docs.nc_program.current_revision].filter(Boolean).join(' / '),
          })}
          {canAdopt && <button type="button" onClick={adopt} className="ml-auto rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white">{t('files.adopt')}</button>}
        </div>
      )}
    </div>
  );
}
