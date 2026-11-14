import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowUpRight, Factory, Search, Truck, Users, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { Card } from '../../components/ui/Card';
import { num, dateDE, apiError } from '../../lib/format';
import { PageHeader } from '../sales/components';

const inputCls = 'h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

function LotLabel({ lot, qty }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <Link to={`/trace/${encodeURIComponent(lot.lot_number)}`} className="font-mono text-sm font-semibold text-accent hover:underline">{lot.lot_number}</Link>
      <span className="text-sm">{lot.item_code} · {lot.item_name}</span>
      {qty !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{num(qty)} {lot.uom}</span>}
    </span>
  );
}

/** Backward tree: what a lot is made of, down to supplier receipts. */
function BackNode({ node, qty, t }) {
  const o = node.origin;
  return (
    <li className="space-y-1">
      <LotLabel lot={node.lot} qty={qty} />
      <div className="text-xs text-muted-foreground">
        {o?.type === 'production' && o.order && (
          <span className="inline-flex items-center gap-1"><Factory size={12} aria-hidden />{t('ops.trace.produced_by', { id: o.order.id, name: o.order.product_name })}{o.order.actual_end ? ` · ${dateDE(o.order.actual_end)}` : ''}</span>
        )}
        {o?.receipts?.map((r) => (
          <span key={r.receipt_id} className="mr-3 inline-flex items-center gap-1">
            <Truck size={12} aria-hidden />{r.supplier_name || t('ops.trace.unknown_supplier')} · {dateDE(r.received_at)}{r.document_reference ? ` · ${r.document_reference}` : ''}
          </span>
        ))}
        {o && o.type !== 'production' && !o.receipts?.length && <span>{t(`ops.trace.source.${o.type}`, { defaultValue: o.type })}</span>}
      </div>
      {node.materials?.length > 0 && (
        <ul className="ml-3 space-y-2 border-l border-border pl-4">
          {node.materials.map((m) => <BackNode key={m.lot.id} node={m} qty={m.quantity} t={t} />)}
        </ul>
      )}
    </li>
  );
}

/** Forward tree: where a lot went (production orders, produced lots, deliveries). */
function FwdNode({ node, t, qty }) {
  return (
    <li className="space-y-1">
      <LotLabel lot={node.lot} qty={qty} />
      {node.usage?.length > 0 && (
        <ul className="ml-3 space-y-2 border-l border-border pl-4">
          {node.usage.map((u, i) => (
            <li key={i} className="space-y-1 text-sm">
              {u.type === 'production' && (
                <>
                  <div className="flex items-center gap-1 text-muted-foreground"><Factory size={14} aria-hidden />
                    {t('ops.trace.used_in', { qty: num(u.quantity), id: u.order?.id, name: u.order?.product_name })}
                  </div>
                  {u.produced?.length > 0 && <ul className="space-y-2">{u.produced.map((p) => <FwdNode key={p.lot.id} node={p} t={t} />)}</ul>}
                </>
              )}
              {u.type === 'delivery' && (
                <div className="flex items-center gap-1"><Users size={14} className="text-emerald-700" aria-hidden />
                  <Link to={`/sales/documents/${u.delivery?.id}`} className="hover:underline">{t('ops.trace.delivered', { qty: num(u.quantity), customer: u.delivery?.customer_name, number: u.delivery?.number || '—' })}</Link>
                  <span className="text-xs text-muted-foreground">{dateDE(u.delivery?.document_date)}</span>
                </div>
              )}
              {u.type !== 'production' && u.type !== 'delivery' && (
                <div className="text-muted-foreground">{t(`ops.trace.move.${u.type}`, { defaultValue: u.type })}: {num(u.quantity)} · {dateDE(u.date)}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function TracePage() {
  const { t } = useTranslation();
  const { lot: lotParam } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [lots, setLots] = useState([]);
  const [loaded, setLoaded] = useState(null); // { lot, data }

  useEffect(() => {
    const h = setTimeout(() => {
      api.get('/trace', { params: { q } }).then((r) => setLots(r.data)).catch((err) => toast.error(apiError(err, t('sales.messages.error'))));
    }, 250);
    return () => clearTimeout(h);
  }, [q, t]);

  useEffect(() => {
    if (!lotParam) return;
    api.get(`/trace/${encodeURIComponent(lotParam)}`).then((r) => setLoaded({ lot: lotParam, data: r.data }))
      .catch((err) => toast.error(apiError(err, t('sales.messages.error'))));
  }, [lotParam, t]);
  const data = lotParam && loaded?.lot === lotParam ? loaded.data : null;

  return (
    <div>
      <PageHeader title={t('ops.trace.title')} />
      <p className="-mt-4 mb-6 max-w-3xl text-sm text-muted-foreground">{t('ops.trace.intro')}</p>
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="min-w-0 space-y-3 self-start">
          <label className="relative block">
            <span className="sr-only">{t('ops.trace.search')}</span>
            <Search size={16} className="absolute left-3 top-3 text-muted-foreground" aria-hidden />
            <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ops.trace.search')} />
          </label>
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {lots.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => navigate(`/trace/${encodeURIComponent(l.lot_number)}`)}
                  className={`w-full px-2 py-2 text-left hover:bg-muted/50 ${l.lot_number === lotParam ? 'bg-accent/10' : ''}`}>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-mono text-sm font-semibold">{l.lot_number}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{t(`ops.trace.source.${l.source_type}`, { defaultValue: l.source_type })}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{l.item_code} · {l.item_name} · {num(l.quantity)} {l.uom}</div>
                </button>
              </li>
            ))}
            {!lots.length && <li className="px-2 py-6 text-center text-sm text-muted-foreground">{t('ops.trace.no_lots')}</li>}
          </ul>
        </Card>

        {!data && (
          <Card className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
            <Package size={18} className="mr-2" aria-hidden />{t('ops.trace.pick_lot')}
          </Card>
        )}

        {data && (
          <div className="min-w-0 space-y-6">
            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-mono text-xl font-bold">{data.lot.lot_number}</div>
                  <div className="text-sm text-muted-foreground">{data.lot.item_code} · {data.lot.item_name}</div>
                </div>
                <div className="text-right text-sm">
                  <div>{t('ops.trace.in_stock')}: <span className="font-semibold tabular-nums">{num(data.lot.quantity)} {data.lot.uom}</span></div>
                  <div className="text-muted-foreground">{t(`ops.trace.source.${data.lot.source_type}`, { defaultValue: data.lot.source_type })} · {dateDE(data.lot.created_at)}</div>
                </div>
              </div>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <h2 className="mb-2 flex items-center gap-2 font-semibold"><Users size={16} aria-hidden />{t('ops.trace.customers')} ({data.customers.length})</h2>
                {data.customers.length ? (
                  <ul className="space-y-1 text-sm">
                    {data.customers.map((c) => (
                      <li key={c.id} className="flex flex-wrap justify-between gap-x-3">
                        <Link to={`/sales/documents/${c.id}`} className="min-w-0 hover:underline">{c.customer_name} · {c.number || '—'}</Link>
                        <span className="whitespace-nowrap tabular-nums text-muted-foreground">{num(c.quantity)} × {c.item_code}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">{t('ops.trace.no_customers')}</p>}
              </Card>
              <Card>
                <h2 className="mb-2 flex items-center gap-2 font-semibold"><Truck size={16} aria-hidden />{t('ops.trace.suppliers')} ({data.suppliers.length})</h2>
                {data.suppliers.length ? (
                  <ul className="space-y-1 text-sm">
                    {data.suppliers.map((s) => (
                      <li key={`${s.lot_number}-${s.receipt_id}`} className="flex justify-between gap-2">
                        <span>{s.supplier_name || t('ops.trace.unknown_supplier')} · <span className="font-mono">{s.lot_number}</span></span>
                        <span className="text-muted-foreground">{dateDE(s.received_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">{t('ops.trace.no_suppliers')}</p>}
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <h2 className="mb-3 flex items-center gap-2 font-semibold"><ArrowDownLeft size={16} aria-hidden />{t('ops.trace.backward')}</h2>
                <ul><BackNode node={data.backward} t={t} /></ul>
              </Card>
              <Card>
                <h2 className="mb-3 flex items-center gap-2 font-semibold"><ArrowUpRight size={16} aria-hidden />{t('ops.trace.forward')}</h2>
                <ul><FwdNode node={data.forward} t={t} /></ul>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
