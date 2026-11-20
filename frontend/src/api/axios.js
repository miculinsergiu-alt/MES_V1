import axios from 'axios';

// The login session lives in an httpOnly cookie set by the server, so page
// scripts never see the token. The custom header marks requests as coming
// from this app (the server refuses cookie-authenticated changes without it).
const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'NOVA' },
});

// Tokens kept by older versions in localStorage are no longer used.
try { localStorage.removeItem('sf_token'); } catch { /* storage unavailable */ }

const PUBLIC_AUTH_CALLS = ['/auth/login', '/auth/demo', '/auth/signup', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email'];

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // 401 = not logged in / session expired -> back to login.
    // 403 = logged in but not allowed (role) -> let the screen show the error.
    const url = err.config?.url || '';
    if (err.response?.status === 401 && !PUBLIC_AUTH_CALLS.some((p) => url.includes(p))) {
      localStorage.removeItem('sf_user');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
