import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Factory, Lock, CreditCard, Loader, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

const ROLE_ROUTES = {
  administrator: '/admin',
  planner: '/planner',
  area_supervisor: '/supervisor',
  shift_responsible: '/shift',
  operator: '/operator',
  material_planner: '/inventory',
};

const fadeInUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } }
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } }
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [badge, setBadge] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!badge || !password) return toast.error(t('login.error_fill'));
    setLoading(true);
    try {
      const user = await login(badge.trim().toUpperCase(), password);
      toast.success(t('login.welcome', { name: user.first_name }));
      navigate(ROLE_ROUTES[user.role] || '/');
    } catch (err) {
      toast.error(err.response?.data?.error || t('login.auth_error'));
    } finally {
      setLoading(false);
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
          <Badge className="mb-6" pulsing>Live Platform</Badge>
          <h1 className="font-display text-5xl md:text-6xl text-foreground leading-tight mb-4 relative">
            SmartFactory <span className="gradient-text">Flow</span>
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
                <label className="text-sm font-medium text-foreground/80 ml-1">{t('login.badge')}</label>
                <div className="relative group">
                  <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-accent transition-colors" size={18} />
                  <Input 
                    id="badge-input"
                    className="pl-12" 
                    placeholder="ADMIN001" 
                    value={badge} 
                    onChange={e => setBadge(e.target.value)}
                    autoFocus
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

            <div className="mt-10 pt-8 border-t border-border">
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{t('login.demo_credentials')}</span>
                <div className="h-1 flex-1 bg-border/30 mx-4 rounded-full" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { role: t('roles.administrator'), badge: 'ADMIN001', pass: 'admin123' },
                  { role: t('roles.planner'), badge: 'PLN001', pass: 'pass123' },
                  { role: t('roles.area_supervisor'), badge: 'SPV001', pass: 'pass123' },
                  { role: t('roles.shift_responsible'), badge: 'SHR001', pass: 'pass123' },
                  { role: t('roles.operator'), badge: 'OPR001', pass: 'pass123' },
                  { role: t('roles.material_planner'), badge: 'MAT001', pass: 'pass123' }
                ].map((cred) => (
                  <button
                    key={cred.badge}
                    type="button"
                    onClick={() => {
                      setBadge(cred.badge);
                      setPassword(cred.pass);
                    }}
                    className="flex flex-col items-start p-3 rounded-xl bg-muted/30 border border-border/50 hover:border-accent/50 hover:bg-accent/5 transition-all duration-200 group/item text-left"
                  >
                    <span className="text-[9px] uppercase text-muted-foreground font-bold tracking-tighter mb-1 group-hover/item:text-accent transition-colors">{cred.role}</span>
                    <div className="flex flex-col">
                      <span className="text-xs font-mono font-bold text-foreground">{cred.badge}</span>
                      <span className="text-[10px] font-mono text-muted-foreground/70 group-hover/item:text-muted-foreground transition-colors">{cred.pass}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.p variants={fadeInUp} className="text-center mt-8 text-muted-foreground text-sm">
          &copy; 2026 SmartFactory Flow. {t('login.rights')}
        </motion.p>
      </motion.div>
    </div>
  );
}
