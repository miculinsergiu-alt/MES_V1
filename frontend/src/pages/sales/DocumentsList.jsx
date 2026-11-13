import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../contexts/AuthContext';
import { eur, dateDE, apiError } from '../../lib/format';
import { StatusPill, PageHeader } from './components';
import { EDIT_ROLES } from '../../lib/roles';

const TYPES = ['all', 'quote', 'order', 'delivery', 'invoice', 'credit_note'];
const CREATABLE = ['quote', 'order', 'delivery', 'invoice'];

export default function DocumentsList() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const type = params.get('type') || 'all';
  const [search, setSearch] = useState('');
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (type !== 'all') q.set('doc_type', type);
      if (search) q.set('search', search);
      const res = await api.get(`/sales?${q}`);
      setDocs(res.data);
    } catch (err) {
      toast.error(apiError(err, t('sales.messages.error')));
    } finally {
      setLoading(false);
    }
  }, [type, search, t]);

  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  const canEdit = EDIT_ROLES.includes(user?.role);

  return (
    <div>
      <PageHeader title={t('sales.nav.documents')}>
        {canEdit && CREATABLE.map((dt) => (
          <Button key={dt} size="sm" variant={dt === 'invoice' ? 'primary' : 'secondary'} onClick={() => navigate(`/sales/documents/new?type=${dt}`)}>
            <Plus size={14} className="mr-1" /> {t(`sales.types.${dt}`)}
          </Button>
        ))}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1" role="tablist">
          {TYPES.map((tp) => (
            <button
              key={tp}
              role="tab"
              aria-selected={type === tp}
              onClick={() => setParams(tp === 'all' ? {} : { type: tp })}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${type === tp ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t(`sales.types_plural.${tp}`)}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-10 pl-9" placeholder={t('sales.fields.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="table-container overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>{t('sales.fields.number')}</th>
              <th>{t('sales.fields.date')}</th>
              <th>{t('sales.fields.customer')}</th>
              <th className="text-right">{t('sales.fields.net')}</th>
              <th className="text-right">{t('sales.fields.gross')}</th>
              <th>{t('sales.fields.status')}</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/sales/documents/${d.id}`)}>
                <td className="font-mono text-sm">
                  <div>{d.number || '—'}</div>
                  <div className="text-xs text-muted-foreground font-sans">{t(`sales.types.${d.doc_type}`)}</div>
                </td>
                <td>{dateDE(d.document_date)}</td>
                <td>{d.customer_name}</td>
                <td className="text-right tabular-nums">{d.doc_type === 'delivery' ? '' : eur(d.net_total)}</td>
                <td className="text-right tabular-nums">{d.doc_type === 'delivery' ? '' : eur(d.gross_total)}</td>
                <td><StatusPill status={d.status} t={t} /></td>
              </tr>
            ))}
            {!loading && !docs.length && (
              <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">—</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
