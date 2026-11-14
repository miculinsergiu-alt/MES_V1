import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/axios';

const AuthContext = createContext(null);

function store(session) {
  localStorage.setItem('sf_token', session.token);
  localStorage.setItem('sf_user', JSON.stringify(session.user));
  try { localStorage.setItem('sf_company', session.user.company_code); } catch { /* storage unavailable */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sf_user')); } catch { return null; }
  });

  const login = async (company_code, badge_number, password) => {
    const res = await api.post('/auth/login', { company_code, badge_number, password });
    store(res.data);
    setUser(res.data.user);
    return res.data.user;
  };

  /** After self-service registration the new administrator is logged in directly. */
  const signup = async (data) => {
    const res = await api.post('/auth/signup', data);
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
    localStorage.removeItem('sf_token');
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
