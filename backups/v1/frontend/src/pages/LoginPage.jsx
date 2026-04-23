import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Factory, Lock, CreditCard, Loader } from 'lucide-react';

const ROLE_ROUTES = {
  administrator: '/admin',
  planner: '/planner',
  area_supervisor: '/supervisor',
  shift_responsible: '/shift',
  operator: '/operator',
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [badge, setBadge] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!badge || !password) return toast.error('Completați toate câmpurile');
    setLoading(true);
    try {
      const user = await login(badge.trim().toUpperCase(), password);
      toast.success(`Bun venit, ${user.first_name}!`);
      navigate(ROLE_ROUTES[user.role] || '/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Eroare la autentificare');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card fade-in">
        <div className="login-logo">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginBottom:8 }}>
            <Factory size={32} color="#60a5fa" />
          </div>
          <h1>SmartFactory Flow</h1>
          <p>Sistem de Management al Producției</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Număr Legitimație</label>
            <div style={{ position:'relative' }}>
              <CreditCard size={16} style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }} />
              <input id="badge-input" className="form-input" style={{ paddingLeft:36 }} placeholder="ex: ADMIN001" value={badge} onChange={e => setBadge(e.target.value)} autoFocus />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Parolă</label>
            <div style={{ position:'relative' }}>
              <Lock size={16} style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }} />
              <input id="password-input" className="form-input" style={{ paddingLeft:36 }} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
          </div>
          <button id="login-btn" type="submit" className="btn btn-primary w-full" style={{ marginTop:8, justifyContent:'center' }} disabled={loading}>
            {loading ? <Loader size={16} className="spinner" /> : null}
            {loading ? 'Se autentifică...' : 'Autentificare'}
          </button>
        </form>

        <div style={{ marginTop:24, padding:16, background:'rgba(255,255,255,0.03)', borderRadius:'var(--radius-sm)', border:'1px solid var(--border)' }}>
          <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:8, fontWeight:600 }}>CREDENȚIALE DEMO</p>
          {[['Admin','ADMIN001','admin123'],['Planner','PLN001','pass123'],['Supervisor','SPV001','pass123'],['Ș.Resp.','SHR001','pass123'],['Operator','OPR001','pass123']].map(([role,b,p]) => (
            <div key={b} style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text-muted)', marginBottom:2 }}>
              <span>{role}</span>
              <span style={{ color:'var(--blue-light)' }}>{b} / {p}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
