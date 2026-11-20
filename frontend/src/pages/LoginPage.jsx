import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Factory, Lock, CreditCard, Loader, ArrowRight, Building2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import novaLogo from '../assets/NOVA.jpg';
import { homeFor } from '../navigation';

// One-click demo: shown when the server has the demo login switched on (DEMO_LOGIN).
const DEMO_ROLES = [
  ['administrator', 'ADMIN001'], ['sales', 'VK001'], ['accounting', 'FIB001'],
  ['planner', 'PLN001'], ['shift_responsible', 'SHR001'], ['operator', 'OPR001'], ['warehouse_manager', 'WHM001'],
];
const COMPANY_KEY = 'sf_company';

const fadeInUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } }
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } }
};

export default function LoginPage() {
  const { login, demoLogin } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [company, setCompany] = useState(() => {
    try { return localStorage.getItem(COMPANY_KEY) || ''; } catch { return ''; }
  });
  const [badge, setBadge] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoLoading, setDemoLoading] = useState(null);
  // Second step for users with two-factor login.
  const [needsTotp, setNeedsTotp] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  useEffect(() => {
    api.get('/auth/signup-config').then((r) => { setSignupOpen(!!r.data.enabled); setDemoOpen(!!r.data.demo); }).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!company || !badge || !password) return toast.error(t('login.error_fill'));
    setLoading(true);
    try {
      const companyCode = company.trim().toUpperCase();
      const user = await login(companyCode, badge.trim().toUpperCase(), password, needsTotp ? totpCode : undefined);
      try { localStorage.setItem(COMPANY_KEY, companyCode); } catch { /* storage unavailable */ }
      toast.success(t('login.welcome', { name: user.first_name }));
      navigate(homeFor(user));
    } catch (err) {
      if (err.response?.data?.code === 'TOTP_REQUIRED') { setNeedsTotp(true); return; }
      toast.error(err.response?.data?.error || t('login.auth_error'));
    } finally {
      setLoading(false);
    }
  };

  const enterDemo = async (badgeNumber) => {
    setDemoLoading(badgeNumber);
    try {
      const user = await demoLogin(badgeNumber);
      toast.success(t('login.welcome', { name: user.first_name }));
      navigate(homeFor(user));
    } catch (err) {
      toast.error(err.response?.data?.error || t('login.auth_error'));
    } finally {
      setDemoLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-6 right-6 z-50">
        <LanguageSwitcher />
      </div>

      {/* Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent-secondary/5 rounded-full blur-[120px] pointer-events-none" />
      
      <motion.div 
        className="w-full max-w-xl z-10"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        <motion.div variants={fadeInUp} className="flex flex-col items-center mb-12 text-center">
          <div className="w-24 h-24 rounded-2xl overflow-hidden shadow-2xl mb-8 border-2 border-accent/20 p-1 bg-white">
            <img src={novaLogo} alt="NOVA Logo" className="w-full h-full object-cover rounded-xl" />
          </div>
          <Badge className="mb-4" pulsing>ERP</Badge>
          <h1 className="font-display text-6xl md:text-7xl text-foreground font-black leading-tight mb-4 relative tracking-tighter">
            NOVA
            <span className="gradient-underline" />
          </h1>
          <p className="text-muted-foreground text-lg max-w-md">
            {t('login.subtitle')}
          </p>
        </motion.div>

        <motion.div variants={fadeInUp}>
          <Card className="p-8 md:p-10 border-border/50">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80 ml-1" htmlFor="company-input">{t('login.company')}</label>
                <div className="relative group">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-accent transition-colors" size={18} />
                  <Input
                    id="company-input"
                    className="pl-12 uppercase"
                    placeholder={t('login.company_placeholder')}
                    value={company}
                    autoComplete="organization"
                    onChange={e => setCompany(e.target.value)}
                    autoFocus={!company}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80 ml-1">{t('login.badge')}</label>
                <div className="relative group">
                  <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-accent transition-colors" size={18} />
                  <Input 
                    id="badge-input"
                    className="pl-12" 
                    placeholder="ADMIN001" 
                    value={badge}
                    onChange={e => setBadge(e.target.value)}
                    autoFocus={!!company}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80 ml-1">{t('login.password')}</label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-accent transition-colors" size={18} />
                  <Input 
                    id="password-input"
                    className="pl-12" 
                    type="password" 
                    placeholder="••••••••" 
                    value={password} 
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
              </div>

              {needsTotp && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/80 ml-1" htmlFor="totp-input">{t('account.totp_label')}</label>
                  <Input
                    id="totp-input"
                    className="text-center font-mono text-xl tracking-[0.5em]"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground ml-1">{t('account.totp_hint')}</p>
                </div>
              )}

              <Button type="submit" className="w-full group h-14" disabled={loading}>
                {loading ? (
                  <Loader className="animate-spin mr-2" size={20} />
                ) : (
                  <>
                    {t('login.button')}
                    <ArrowRight className="ml-2 group-hover:translate-x-1 transition-transform" size={20} />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-4 text-center text-sm">
              <Link to="/forgot-password" className="text-muted-foreground hover:text-accent hover:underline">{t('account.forgot_link')}</Link>
            </p>

            {signupOpen && (
              <p className="mt-6 text-center text-sm">
                <Link to="/signup" className="font-medium text-accent hover:underline">{t('onboarding.signup.link')}</Link>
              </p>
            )}

            {demoOpen && <div className="mt-10 pt-8 border-t border-border">
              <Button type="button" variant="outline" className="w-full h-12" disabled={!!demoLoading} onClick={() => enterDemo('ADMIN001')}>
                {demoLoading === 'ADMIN001' ? <Loader className="animate-spin mr-2" size={18} /> : null}
                {t('login.demo_button')}
              </Button>
              <p className="mt-3 text-xs text-center text-muted-foreground">{t('login.demo_hint')}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {DEMO_ROLES.slice(1).map(([role, badgeNumber]) => (
                  <button key={badgeNumber} type="button" disabled={!!demoLoading} onClick={() => enterDemo(badgeNumber)}
                    className="px-3 py-1.5 rounded-full text-xs bg-muted/30 border border-border/50 hover:border-accent/50 hover:bg-accent/5 transition-colors disabled:opacity-50">
                    {demoLoading === badgeNumber ? '…' : t(`roles.${role}`)}
                  </button>
                ))}
              </div>
            </div>}
          </Card>
        </motion.div>

        <motion.p variants={fadeInUp} className="text-center mt-8 text-muted-foreground text-sm">
          &copy; 2026 NOVA. {t('login.rights')}
        </motion.p>
      </motion.div>
    </div>
  );
}
