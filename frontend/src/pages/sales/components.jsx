/** Small status pill used across the sales screens. */
export function StatusPill({ status, t }) {
  const colors = {
    draft: 'bg-slate-100 text-slate-600',
    issued: 'bg-blue-50 text-blue-700',
    accepted: 'bg-emerald-50 text-emerald-700',
    declined: 'bg-rose-50 text-rose-700',
    partially_delivered: 'bg-amber-50 text-amber-700',
    delivered: 'bg-emerald-50 text-emerald-700',
    closed: 'bg-slate-100 text-slate-600',
    partially_paid: 'bg-amber-50 text-amber-700',
    paid: 'bg-emerald-50 text-emerald-700',
    cancelled: 'bg-rose-50 text-rose-700',
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors[status] || 'bg-slate-100'}`}>
      {t(`sales.status.${status}`)}
    </span>
  );
}

export function PageHeader({ title, children }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 className="font-display text-3xl text-foreground">{title}</h1>
      <div className="flex flex-wrap gap-2">{children}</div>
    </header>
  );
}
