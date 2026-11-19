import { hasAnyRole, rolesOf } from '../lib/roles';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Menu, Search, UserCog, X } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { navFor, rolesFor, homeFor } from '../navigation';
import { LanguageSwitcher } from './LanguageSwitcher';
import novaLogo from '../assets/NOVA.jpg';

/** Picks the most specific menu entry for the current path (so /supervisor/oee does not also mark /supervisor). */
function activePath(groups, pathname) {
  let best = null;
  for (const g of groups) {
    for (const i of g.items) {
      if ((pathname === i.path || pathname.startsWith(`${i.path}/`)) && (!best || i.path.length > best.length)) best = i.path;
    }
  }
  return best;
}

function SidebarContent({ groups, onNavigate }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const active = activePath(groups, pathname);
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label={t('shell.menu')}>
      {groups.map((g) => (
        <div key={g.key}>
          <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t(`shell.groups.${g.key}`)}</div>
          <ul className="space-y-0.5">
            {g.items.map(({ path, key, icon: Icon }) => (
              <li key={path}>
                <NavLink
                  to={path}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active === path ? 'bg-accent/10 font-semibold text-accent' : 'text-foreground/80 hover:bg-muted'}`}
                  aria-current={active === path ? 'page' : undefined}
                >
                  <Icon size={17} />
                  <span>{t(`shell.items.${key}`)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef(null);

  // Ctrl+K / Cmd+K focuses the search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return undefined;
    const id = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(q.trim())}`).then((r) => { setResults(r.data); setCursor(0); }).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  const shown = q.trim().length >= 2 ? results : [];
  const go = (r) => { setOpen(false); setQ(''); navigate(r.path); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter' && shown[cursor]) go(shown[cursor]);
    if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  };

  return (
    <div className="relative w-full max-w-md">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded={open && q.length >= 2}
        aria-controls="global-search-results"
        aria-label={t('shell.search.placeholder')}
        className="h-10 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        placeholder={t('shell.search.placeholder')}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && q.trim().length >= 2 && (
        <ul id="global-search-results" role="listbox" className="absolute left-0 right-0 top-12 z-50 max-h-96 overflow-y-auto rounded-xl border border-border bg-white py-1 shadow-xl">
          {shown.map((r, i) => (
            <li key={`${r.type}-${r.id}`} role="option" aria-selected={i === cursor}>
              <button type="button" onMouseDown={() => go(r)} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === cursor ? 'bg-muted' : 'hover:bg-muted/60'}`}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.title}</span>
                  {r.subtitle && <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>}
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">{t(`shell.search.types.${r.type}`)}</span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-3 py-2 text-sm text-muted-foreground">{t('shell.search.none')}</li>}
        </ul>
      )}
    </div>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const groups = useMemo(() => navFor(user), [user]);

  if (!user) return <Navigate to="/login" replace />;
  // New companies: the administrator goes through the setup wizard first.
  if (hasAnyRole(user, ['administrator']) && user.onboarding_completed === 0) return <Navigate to="/setup" replace />;
  const allowed = rolesFor(pathname);
  if (allowed && !hasAnyRole(user, allowed)) return <Navigate to={homeFor(user)} replace />;

  const handleLogout = () => { logout(); navigate('/login'); };

  const brand = (
    <div className="flex items-center gap-3 px-5 py-4">
      <img src={novaLogo} alt="" className="h-9 w-9 rounded-lg object-cover" />
      <div className="min-w-0">
        <div className="font-display text-lg font-bold leading-tight">NOVA</div>
        <div className="truncate text-xs text-muted-foreground">{user.company_name || user.company_code}</div>
      </div>
    </div>
  );

  const userBox = (
    <div className="border-t border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{user.first_name} {user.last_name}</div>
          <div className="truncate text-xs text-muted-foreground">{rolesOf(user).map((r) => t(`roles.${r}`)).join(', ')} · {user.badge_number}</div>
        </div>
        <LanguageSwitcher />
      </div>
      <button type="button" onClick={() => navigate('/account')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <UserCog size={16} /> {t('account.security.title')}
      </button>
      <button type="button" onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <LogOut size={16} /> {t('shell.logout')}
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
        {brand}
        <SidebarContent groups={groups} />
        {userBox}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-card shadow-xl">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" aria-label={t('shell.close')} className="rounded-lg p-2 hover:bg-muted" onClick={() => setMobileOpen(false)}><X size={20} /></button>
            </div>
            <SidebarContent groups={groups} onNavigate={() => setMobileOpen(false)} />
            {userBox}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur lg:px-8">
          <button type="button" aria-label={t('shell.menu')} className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={22} /></button>
          <GlobalSearch />
        </header>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
