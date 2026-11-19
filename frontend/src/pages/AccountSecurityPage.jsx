/**
 * "My account": change own password, turn two-factor login on or off.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import QRCode from 'qrcode';
import { ShieldCheck, KeyRound } from 'lucide-react';
import api from '../api/axios';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { apiError } from '../lib/format';

const inputCls = 'h-11 w-full rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent';

function PasswordCard() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next });
      setCurrent(''); setNext('');
      toast.success(t('account.security.password_changed'));
    } catch (err) { toast.error(apiError(err, 'Error')); } finally { setBusy(false); }
  };

  return (
    <Card className="space-y-4 p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound size={18} />{t('account.security.change_password')}</h2>
      <form onSubmit={submit} className="space-y-3">
        <input className={inputCls} type="password" autoComplete="current-password" placeholder={t('account.security.current_password')} value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <input className={inputCls} type="password" autoComplete="new-password" minLength={10} placeholder={t('account.security.new_password')} value={next} onChange={(e) => setNext(e.target.value)} required />
        <Button type="submit" disabled={busy}>{t('account.security.save')}</Button>
      </form>
    </Card>
  );
}

function TwoFactorCard() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(null);
  const [setup, setSetup] = useState(null); // { secret, qr }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/auth/me').then((r) => setEnabled(!!r.data.totp_enabled)).catch(() => {}); }, []);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (err) { toast.error(apiError(err, 'Error')); } finally { setBusy(false); }
  };

  const start = () => run(async () => {
    const { data } = await api.post('/auth/2fa/setup');
    setSetup({ secret: data.secret, qr: await QRCode.toDataURL(data.otpauth_url, { margin: 1, width: 200 }) });
  });
  const enable = (e) => { e.preventDefault(); run(async () => {
    await api.post('/auth/2fa/enable', { code });
    setEnabled(true); setSetup(null); setCode('');
    toast.success(t('account.security.twofa_enabled'));
  }); };
  const disable = (e) => { e.preventDefault(); run(async () => {
    await api.post('/auth/2fa/disable', { password });
    setEnabled(false); setPassword('');
    toast.success(t('account.security.twofa_disabled'));
  }); };

  return (
    <Card className="space-y-4 p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={18} />{t('account.security.twofa')}</h2>
      {enabled === null ? null : enabled ? (
        <>
          <p className="text-sm text-muted-foreground">{t('account.security.twofa_on')}</p>
          <form onSubmit={disable} className="flex flex-wrap gap-2">
            <input className={`${inputCls} max-w-xs`} type="password" placeholder={t('account.security.twofa_disable_password')} value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Button type="submit" variant="secondary" disabled={busy}>{t('account.security.twofa_disable')}</Button>
          </form>
        </>
      ) : setup ? (
        <form onSubmit={enable} className="space-y-3">
          <p className="text-sm">{t('account.security.twofa_scan')}</p>
          <img src={setup.qr} alt="QR" width={200} height={200} className="rounded-lg border border-border" />
          <code className="block break-all rounded-lg bg-muted/50 p-2 text-xs">{setup.secret}</code>
          <p className="text-sm">{t('account.security.twofa_confirm')}</p>
          <div className="flex flex-wrap gap-2">
            <input className={`${inputCls} max-w-[10rem] text-center font-mono tracking-widest`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            <Button type="submit" disabled={busy}>{t('account.security.twofa_enable')}</Button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('account.security.twofa_off')}</p>
          <Button onClick={start} disabled={busy}>{t('account.security.twofa_start')}</Button>
        </>
      )}
    </Card>
  );
}

export default function AccountSecurityPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-3xl">{t('account.security.title')}</h1>
        <p className="text-muted-foreground">{t('account.security.subtitle')}</p>
      </div>
      <PasswordCard />
      <TwoFactorCard />
    </div>
  );
}
