/** "Today": everything that needs action, from all modules, for the user's roles. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '../api/axios';
import { Card } from './ui/Card';
import { eur, dateDE } from '../lib/format';

const DOT = { high: 'bg-rose-500', medium: 'bg-amber-400', low: 'bg-slate-300' };

export default function TodayPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [all, setAll] = useState(false);
  useEffect(() => { api.get('/today').then((r) => setData(r.data)).catch(() => setData(null)); }, []);
  if (!data) return null;
  if (!data.total) {
    return <Card className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={18} />{t('today.nothing')}</Card>;
  }
  const items = all ? data.items : data.items.slice(0, 8);
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle size={18} className="text-amber-500" />{t('today.title', { count: data.total })}</h2>
        <div className="flex flex-wrap gap-1">
          {Object.entries(data.counts).map(([k, n]) => <span key={k} className="rounded bg-muted px-2 py-0.5 text-xs">{t(`today.cat.${k}`)} {n}</span>)}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {items.map((x) => (
          <li key={`${x.category}-${x.id}`}>
            <Link to={x.link} className="flex items-center gap-3 py-2 text-sm hover:bg-muted/40">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[x.severity]}`} />
              <span className="w-40 shrink-0 text-xs text-muted-foreground">{t(`today.cat.${x.category}`)}</span>
              <span className="min-w-0 flex-1 truncate">{x.title}</span>
              {x.amount !== undefined && <span className="tabular-nums">{eur(x.amount)}</span>}
              {x.date && <span className={`text-xs ${x.overdue !== false ? 'text-rose-600' : 'text-muted-foreground'}`}>{dateDE(x.date)}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {data.items.length > 8 && <button type="button" className="text-sm text-accent" onClick={() => setAll(!all)}>{all ? t('today.less') : t('today.more', { count: data.items.length - 8 })}</button>}
    </Card>
  );
}
