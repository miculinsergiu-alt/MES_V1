import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, Box, LayoutDashboard, FileText, Factory, BarChart2, Users } from 'lucide-react';

export default function Sidebar({ items }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => { logout(); navigate('/login'); };

  const roleLabel = {
    administrator: 'Administrator',
    planner: 'Planner',
    area_supervisor: 'Area Supervisor',
    shift_responsible: 'Shift Responsible',
    operator: 'Operator',
  };

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <h2>SmartFactory Flow</h2>
        <span>MES v1.0</span>
      </div>
      <nav className="sidebar-nav">
        {items.map(item => (
          <button
            key={item.path}
            className={`nav-item ${location.pathname.startsWith(item.path) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <strong>{user?.first_name} {user?.last_name}</strong>
          {roleLabel[user?.role]}
          <div style={{ fontSize:11, marginTop:2, color:'var(--text-muted)' }}>#{user?.badge_number}</div>
        </div>
        <button className="btn btn-ghost btn-sm w-full" onClick={handleLogout} style={{ justifyContent:'center', gap:6 }}>
          <LogOut size={14} /> Deconectare
        </button>
      </div>
    </div>
  );
}
