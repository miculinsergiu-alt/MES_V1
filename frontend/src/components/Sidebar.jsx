import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Factory } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { LanguageSwitcher } from './LanguageSwitcher';

export default function Sidebar({ items }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="w-72 h-screen bg-card border-r border-border flex flex-col z-20 sticky top-0">
      <div className="p-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center shadow-accent">
            <Factory className="text-white" size={20} />
          </div>
          <h2 className="font-display text-xl text-foreground">SmartFactory <span className="gradient-text">Flow</span></h2>
        </div>
        <div className="ml-12 font-mono text-[10px] uppercase tracking-widest text-muted-foreground font-bold">MES Edition v1.0</div>
      </div>

      <nav className="flex-1 px-4 space-y-2 mt-4">
        {items.map(item => {
          const isActive = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => {
                if (item.onClick) item.onClick();
                else navigate(item.path);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative ${
                isActive 
                  ? 'text-accent bg-accent/5 font-semibold' 
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <div className={`${isActive ? 'text-accent' : 'text-muted-foreground group-hover:text-foreground'} transition-colors`}>
                {item.icon}
              </div>
              <span className="text-sm">{t(item.labelKey || item.label)}</span>
              {isActive && (
                <motion.div 
                  layoutId="active-pill"
                  className="absolute left-0 w-1 h-6 bg-accent rounded-r-full"
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-6 mt-auto border-t border-border bg-muted/30">
        <div className="mb-6 px-2 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">{user?.first_name} {user?.last_name}</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] font-medium text-muted-foreground">{t(`roles.${user?.role}`)}</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span className="font-mono text-[10px] text-accent font-bold">#{user?.badge_number}</span>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
        <Button 
          variant="secondary" 
          size="sm" 
          className="w-full justify-start gap-3 bg-white border-border/50" 
          onClick={handleLogout}
        >
          <LogOut size={16} className="text-muted-foreground" />
          <span>{t('sidebar.logout')}</span>
        </Button>
      </div>
    </div>
  );
}
