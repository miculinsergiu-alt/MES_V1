import TodayPanel from '../components/TodayPanel';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import api from '../api/axios';
import { Card } from '../components/ui/Card';
import { useAuth } from '../contexts/AuthContext';
import { eur } from '../lib/format';

const SECTIONS = [
  { key: 'production', link: '/planner', kpis: ['active_orders', 'pending_orders', 'planned_today', 'late_orders', 'done_today', 'delay_minutes_today'], alert: ['late_orders'] },
  { key: 'maintenance', link: '/supervisor/maintenance', kpis: [['due', 'maintenance_due']], alert: ['due'] },
  { key: 'inventory', link: '/inventory', kpis: ['purchase_recommendations', 'open_purchase_orders', 'quarantine', 'negative_stock'], alert: ['negative_stock'] },
  { key: 'sales', link: '/sales/documents', kpis: ['open_quotes', 'orders_to_deliver', 'open_amount', 'overdue_amount', 'revenue_month'], money: ['open_amount', 'overdue_amount', 'revenue_month'], alert: ['overdue_amount'] },
  { key: 'incoming', link: '/purchase-invoices', kpis: ['to_approve', 'amount'], money: ['amount'] },
];

const SETUP_LINKS = {
  company_data_complete: '/settings', bank_details: '/settings', has_warehouse: '/inventory', has_machines: '/admin',
  has_items: '/import', has_customers: '/import', has_users: '/admin',
};

export default function HomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => { api.get('/dashboard').then((r) => setData(r.data)).catch(() => setData({})); }, []);
  if (!data) return null;

  const setup = data.setup;
  const openSteps = setup ? Object.entries(setup).filter(([, done]) => !done) : [];

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <h1 className="font-display text-3xl">{t('shell.home.title', { name: user.first_name })}</h1>
        <p className="text-muted-foreground">{t('shell.home.subtitle')}</p>
      </header>

      <TodayPanel />

      {setup && openSteps.length > 0 && (
        <Card className="border-accent/30">
          <h2 className="font-semibold">{t('shell.home.setup')}</h2>
          <p className="mb-3 text-sm text-muted-foreground">{t('shell.home.setup_hint')}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {Object.entries(setup).map(([step, done]) => (
              <li key={step}>
                <Link to={SETUP_LINKS[step]} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${done ? 'text-muted-foreground line-through' : 'hover:bg-muted'}`}>
                  {done ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Circle size={18} className="text-accent" />}
                  {t(`shell.home.steps.${step}`)}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {SECTIONS.filter((s) => data[s.key]).map((s) => (
          <Card key={s.key} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{t(`shell.home.${s.key}`)}</h2>
              <Link to={s.link} className="flex items-center gap-1 text-sm text-accent hover:underline">{t('shell.home.open')} <ArrowRight size={14} /></Link>
            </div>
            <dl className="grid grid-cols-2 gap-4">
              {s.kpis.map((k) => {
                const [field, label] = Array.isArray(k) ? k : [k, k];
                const value = data[s.key][field];
                const isAlert = s.alert?.includes(field) && Number(value) > 0;
                return (
                  <div key={field}>
                    <dt className="text-xs text-muted-foreground">{t(`shell.home.${label === 'amount' ? 'open_amount' : label}`)}</dt>
                    <dd className={`text-2xl font-bold tabular-nums ${isAlert ? 'text-rose-700' : ''}`}>{s.money?.includes(field) ? eur(value) : value}</dd>
                  </div>
                );
              })}
            </dl>
          </Card>
        ))}
      </div>
    </div>
  );
}
