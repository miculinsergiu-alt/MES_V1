import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Database, Upload, FileX, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { apiError } from '../lib/format';

const STEPS = ['company', 'bank', 'production', 'data', 'team'];
const ROLES = ['planner', 'area_supervisor', 'shift_responsible', 'operator', 'warehouse_manager', 'material_planner', 'sales', 'accounting', 'administrator'];
const inputCls = 'h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

function Field({ label, children, wide }) {
  return (
    <label className={`block space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export default function SetupWizard() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [company, setCompany] = useState(null);
  const [production, setProduction] = useState({ area: 'Fertigung', machines: '', warehouse: 'Hauptlager' });
  const [dataChoice, setDataChoice] = useState(null);
  const [team, setTeam] = useState([]);

  useEffect(() => {
    api.get('/settings/company').then((r) => {
      const c = r.data;
      setCompany({
        legal_name: c.legal_name || c.name || '', street: c.street || '', postal_code: c.postal_code || '', city: c.city || '',
        vat_id: c.vat_id || '', tax_number: c.tax_number || '', email: c.email || '', phone: c.phone || '',
        bank_name: c.bank_name || '', iban: c.iban || '', bic: c.bic || '', default_payment_terms_days: c.default_payment_terms_days ?? 14,
      });
    }).catch(() => {});
  }, []);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'administrator') return <Navigate to="/" replace />;
  if (!company) return null;

  const setC = (k) => (e) => setCompany((c) => ({ ...c, [k]: e.target.value }));
  const field = (k, label, extra = {}) => <Field label={label} wide={extra.wide}><input className={inputCls} value={company[k]} onChange={setC(k)} type={extra.type || 'text'} /></Field>;

  const saveStep = async () => {
    const key = STEPS[step];
    if (key === 'company') {
      await api.put('/settings/company', Object.fromEntries(['legal_name', 'street', 'postal_code', 'city', 'vat_id', 'tax_number', 'email', 'phone'].map((k) => [k, company[k]])));
    }
    if (key === 'bank') {
      await api.put('/settings/company', { bank_name: company.bank_name, iban: company.iban, bic: company.bic, default_payment_terms_days: company.default_payment_terms_days });
    }
    if (key === 'production') {
      const names = production.machines.split('\n').map((s) => s.trim()).filter(Boolean);
      if (names.length) {
        const area = await api.post('/machines/areas', { name: production.area || 'Fertigung' });
        for (const name of names) await api.post('/machines', { area_id: area.data.id, name });
      }
      if (production.warehouse.trim()) await api.post('/warehousing/warehouses', { name: production.warehouse.trim(), type: 'central' });
    }
    if (key === 'data' && dataChoice === 'sample') {
      await api.post('/setup/sample-data');
      toast.success(t('onboarding.setup.sample_loaded'));
    }
    if (key === 'team') {
      for (const m of team.filter((x) => x.first_name && x.badge_number)) await api.post('/users', m);
    }
  };

  const next = async (skip = false) => {
    setBusy(true);
    try {
      if (!skip) await saveStep();
      if (step < STEPS.length - 1) { setStep(step + 1); return; }
      await api.post('/setup/complete');
      updateUser({ onboarding_completed: 1 });
      toast.success(t('onboarding.setup.finished'));
      navigate(dataChoice === 'import' ? '/import' : '/home', { replace: true });
    } catch (err) {
      toast.error(apiError(err, 'Error'), { duration: 8000 });
    } finally { setBusy(false); }
  };

  const key = STEPS[step];
  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl">{t('onboarding.setup.title')}</h1>
            <p className="text-sm text-muted-foreground">{user.company_name} · {t('onboarding.setup.step', { n: step + 1, total: STEPS.length })}</p>
          </div>
          <LanguageSwitcher />
        </div>

        <ol className="flex gap-2 overflow-x-auto" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${i === step ? 'bg-accent text-white' : i < step ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}`}>
              {i < step ? <Check size={12} /> : <span>{i + 1}</span>}{t(`onboarding.setup.steps.${s}`)}
            </li>
          ))}
        </ol>

        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">{t(`onboarding.setup.steps.${key}`)}</h2>

          {key === 'company' && (
            <>
              <p className="text-sm text-muted-foreground">{t('onboarding.setup.company_hint')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {field('legal_name', t('sales.settings.legal_name'), { wide: true })}
                {field('street', t('sales.customers.street'), { wide: true })}
                {field('postal_code', t('sales.customers.postal_code'))}
                {field('city', t('sales.customers.city'))}
                {field('vat_id', t('sales.customers.vat_id'))}
                {field('tax_number', t('sales.settings.tax_number'))}
                {field('email', t('sales.customers.email'), { type: 'email' })}
                {field('phone', t('sales.customers.phone'))}
              </div>
            </>
          )}

          {key === 'bank' && (
            <>
              <p className="text-sm text-muted-foreground">{t('onboarding.setup.bank_hint')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {field('bank_name', t('sales.settings.bank_name'), { wide: true })}
                {field('iban', t('sales.settings.iban'))}
                {field('bic', t('sales.settings.bic'))}
                {field('default_payment_terms_days', t('sales.settings.default_payment_terms'), { type: 'number' })}
              </div>
            </>
          )}

          {key === 'production' && (
            <>
              <p className="text-sm text-muted-foreground">{t('onboarding.setup.production_hint')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('onboarding.setup.area')}><input className={inputCls} value={production.area} onChange={(e) => setProduction({ ...production, area: e.target.value })} /></Field>
                <Field label={t('onboarding.setup.warehouse')}><input className={inputCls} value={production.warehouse} onChange={(e) => setProduction({ ...production, warehouse: e.target.value })} /></Field>
                <Field label={t('onboarding.setup.machines')} wide>
                  <textarea rows={5} className={`${inputCls} h-auto py-2`} placeholder={t('onboarding.setup.machines_placeholder')} value={production.machines} onChange={(e) => setProduction({ ...production, machines: e.target.value })} />
                </Field>
              </div>
            </>
          )}

          {key === 'data' && (
            <>
              <p className="text-sm text-muted-foreground">{t('onboarding.setup.data_hint')}</p>
              <div className="grid gap-3 sm:grid-cols-3" role="radiogroup">
                {[['sample', Database], ['import', Upload], ['empty', FileX]].map(([k, Icon]) => (
                  <button key={k} type="button" role="radio" aria-checked={dataChoice === k} onClick={() => setDataChoice(k)}
                    className={`rounded-xl border p-4 text-left transition ${dataChoice === k ? 'border-accent bg-accent/5 ring-2 ring-accent' : 'border-border hover:border-accent/50'}`}>
                    <Icon size={20} className="mb-2 text-accent" />
                    <div className="font-semibold">{t(`onboarding.setup.data_${k}`)}</div>
                    <div className="text-xs text-muted-foreground">{t(`onboarding.setup.data_${k}_text`)}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {key === 'team' && (
            <>
              <p className="text-sm text-muted-foreground">{t('onboarding.setup.team_hint')}</p>
              {team.map((m, i) => (
                <div key={i} className="grid gap-2 rounded-xl bg-muted/40 p-3 sm:grid-cols-6">
                  <input aria-label={t('onboarding.signup.first_name')} placeholder={t('onboarding.signup.first_name')} className={`${inputCls} sm:col-span-1`} value={m.first_name} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, first_name: e.target.value } : x)))} />
                  <input aria-label={t('onboarding.signup.last_name')} placeholder={t('onboarding.signup.last_name')} className={`${inputCls} sm:col-span-1`} value={m.last_name} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, last_name: e.target.value } : x)))} />
                  <input aria-label={t('onboarding.setup.badge')} placeholder={t('onboarding.setup.badge')} className={`${inputCls} uppercase`} value={m.badge_number} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, badge_number: e.target.value.toUpperCase() } : x)))} />
                  <select aria-label={t('onboarding.setup.role')} className={inputCls} value={m.role} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                    {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                  </select>
                  <input aria-label={t('onboarding.setup.password')} placeholder={t('onboarding.setup.password')} type="password" className={inputCls} value={m.password} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, password: e.target.value } : x)))} />
                  <button type="button" aria-label="remove" className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-600" onClick={() => setTeam(team.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={() => setTeam([...team, { first_name: '', last_name: '', badge_number: '', role: 'operator', password: '' }])}>
                <Plus size={14} className="mr-1" />{t('onboarding.setup.add_user')}
              </Button>
            </>
          )}
        </Card>

        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)} disabled={step === 0 || busy}>{t('onboarding.setup.back')}</Button>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => next(true)} disabled={busy}>{t('onboarding.setup.skip')}</Button>
            <Button size="sm" onClick={() => next(false)} disabled={busy || (key === 'data' && !dataChoice)}>
              {step === STEPS.length - 1 ? t('onboarding.setup.finish') : t('onboarding.setup.next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
