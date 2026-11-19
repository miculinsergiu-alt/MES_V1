/**
 * Public account pages reached from e-mail links or the login screen:
 * forgot password, reset password, confirm e-mail address.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { apiError } from '../lib/format';

const inputCls = 'h-11 w-full rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

function Shell({ title, children }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <Card className="w-full max-w-md space-y-5 p-6 sm:p-8">
        <h1 className="font-display text-2xl">{title}</h1>
        {children}
        <p className="text-center text-sm">
          <Link to="/login" className="text-accent hover:underline">{t('account.back_to_login')}</Link>
        </p>
      </Card>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground/80">{label}</span>
      <input className={inputCls} {...props} />
    </label>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [company, setCompany] = useState(() => { try { return localStorage.getItem('sf_company') || ''; } catch { return ''; } });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { company_code: company.trim(), email: email.trim() });
      setSent(true);
    } catch (err) { toast.error(apiError(err, 'Error')); } finally { setBusy(false); }
  };

  return (
    <Shell title={t('account.forgot.title')}>
      {sent ? <p className="text-sm">{t('account.forgot.sent')}</p> : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('account.forgot.text')}</p>
          <Field label={t('login.company')} value={company} onChange={(e) => setCompany(e.target.value)} required className={`${inputCls} uppercase`} />
          <Field label={t('account.forgot.email')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Button type="submit" className="w-full" disabled={busy}>{t('account.forgot.button')}</Button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return toast.error(t('account.reset.mismatch'));
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token: params.get('token') || '', password });
      toast.success(t('account.reset.done'));
      navigate('/login');
    } catch (err) { toast.error(apiError(err, 'Error')); } finally { setBusy(false); }
    return undefined;
  };

  return (
    <Shell title={t('account.reset.title')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('account.reset.password')} type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Field label={t('account.reset.confirm')} type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        <Button type="submit" className="w-full" disabled={busy}>{t('account.reset.button')}</Button>
      </form>
    </Shell>
  );
}

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [state, setState] = useState('working');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // the link works only once (React dev mode runs effects twice)
    started.current = true;
    api.post('/auth/verify-email', { token: params.get('token') || '' })
      .then(() => setState('done'))
      .catch(() => setState('failed'));
  }, [params]);

  return (
    <Shell title={t('account.verify.title')}>
      <p className="text-sm">{t(`account.verify.${state}`)}</p>
    </Shell>
  );
}
