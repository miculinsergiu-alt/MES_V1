import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/axios';

const AuthContext = createContext(null);

// Only the user's display data is kept in the browser; the session token stays
// in the httpOnly cookie.
function store(session) {
  localStorage.setItem('sf_user', JSON.stringify(session.user));
  try { localStorage.setItem('sf_company', session.user.company_code); } catch { /* storage unavailable */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sf_user')); } catch { return null; }
  });

  const login = async (company_code, badge_number, password, totp_code) => {
    const res = await api.post('/auth/login', { company_code, badge_number, password, totp_code: totp_code || undefined });
    store(res.data);
    setUser(res.data.user);
    return res.data.user;
  };

  /** After self-service registration the new administrator is logged in directly. */
  const signup = async (data) => {
    const res = await api.post('/auth/signup', data);
    // With e-mail verification on, the account must be confirmed before the first login.
    if (res.data.verification_required) return res.data;
    store(res.data);
    setUser(res.data.user);
    return res.data.user;
  };

  /** Updates locally kept user data (e.g. after the setup wizard). */
  const updateUser = (patch) => {
    setUser((u) => {
      const next = { ...u, ...patch };
      localStorage.setItem('sf_user', JSON.stringify(next));
      return next;
    });
  };

  // Roles can change while someone is logged in (an administrator edits the
  // user). Refresh them on start and whenever the tab comes back into view.
  const loggedIn = !!user;
  useEffect(() => {
    if (!loggedIn) return undefined;
    const refresh = () => {
      api.get('/auth/me').then((res) => {
        const { role, roles, first_name, last_name, onboarding_completed } = res.data;
        updateUser({ role, roles, first_name, last_name, onboarding_completed });
      }).catch(() => { /* 401 is handled by the API client */ });
    };
    refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loggedIn]);

  const logout = () => {
    api.post('/auth/logout').catch(() => { /* cookie expires anyway */ });
    localStorage.removeItem('sf_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, signup, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() { return useContext(AuthContext); }
