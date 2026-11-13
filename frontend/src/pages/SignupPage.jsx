import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { apiError } from '../lib/format';

const inputCls = 'h-11 w-full rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

export default function SignupPage() {
  const { t } = useTranslation();
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({ company_name: '', company_code: '', first_name: '', last_name: '', email: '', password: '', invite_code: '' });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => { api.get('/auth/signup-config').then((r) => setCfg(r.data)).catch(() => setCfg({ enabled: false })); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...form };
      if (!cfg.invite_required) delete body.invite_code;
      setCreated(await signup(body));
    } catch (err) { toast.error(apiError(err, 'Error'), { duration: 8000 }); } finally { setBusy(false); }
  };

  const F = (k, type = 'text', extra = {}) => (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground/80">{t(`onboarding.signup.${k}`)}</span>
      <input type={type} className={inputCls} value={form[k]} onChange={set(k)} {...extra} />
    </label>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <Card className="w-full max-w-lg space-y-5 p-6 sm:p-8">
        {created ? (
          <>
            <h1 className="font-display text-2xl">{t('onboarding.signup.done_title')}</h1>
            <p className="text-sm text-muted-foreground">{t('onboarding.signup.done_text')}</p>
            <dl className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-4 font-mono text-sm">
              <dt className="font-sans text-muted-foreground">{t('login.company')}</dt><dd className="font-bold">{created.company_code}</dd>
              <dt className="font-sans text-muted-foreground">{t('login.badge')}</dt><dd className="font-bold">{created.badge_number}</dd>
            </dl>
            <Button className="w-full" onClick={() => navigate('/setup')}>{t('onboarding.signup.continue')}</Button>
          </>
        ) : (
          <>
            <div>
              <h1 className="font-display text-2xl">{t('onboarding.signup.title')}</h1>
              <p className="text-sm text-muted-foreground">{t('onboarding.signup.subtitle')}</p>
            </div>
            {cfg && !cfg.enabled ? (
              <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{t('onboarding.signup.closed')}</p>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                {F('company_name', 'text', { required: true, autoFocus: true, autoComplete: 'organization' })}
                <div>
                  {F('company_code', 'text', { className: `${inputCls} uppercase`, maxLength: 32 })}
                  <p className="mt-1 text-xs text-muted-foreground">{t('onboarding.signup.company_code_hint')}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {F('first_name', 'text', { required: true, autoComplete: 'given-name' })}
                  {F('last_name', 'text', { required: true, autoComplete: 'family-name' })}
                </div>
                {F('email', 'email', { required: true, autoComplete: 'email' })}
                {F('password', 'password', { required: true, minLength: 10, autoComplete: 'new-password' })}
                {cfg?.invite_required && F('invite_code', 'text', { required: true })}
                <Button type="submit" className="w-full" disabled={busy || !cfg}>{t('onboarding.signup.submit')}</Button>
              </form>
            )}
            <Link to="/login" className="block text-center text-sm text-accent hover:underline">{t('onboarding.signup.back')}</Link>
          </>
        )}
      </Card>
    </div>
  );
}
