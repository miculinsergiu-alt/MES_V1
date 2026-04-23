import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import PlannerDashboard from './pages/planner/PlannerDashboard';
import SupervisorDashboard from './pages/supervisor/SupervisorDashboard';
import ShiftDashboard from './pages/shift/ShiftDashboard';
import OperatorDashboard from './pages/operator/OperatorDashboard';
import './index.css';

const ROLE_ROUTES = {
  administrator: '/admin',
  planner: '/planner',
  area_supervisor: '/supervisor',
  shift_responsible: '/shift',
  operator: '/operator',
};

function PrivateRoute({ children, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={ROLE_ROUTES[user.role] || '/login'} replace />;
  return children;
}

function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_ROUTES[user.role] || '/login'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ style: { background: '#1a2235', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.1)' } }} />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RootRedirect />} />
          <Route path="/admin/*" element={<PrivateRoute roles={['administrator']}><AdminDashboard /></PrivateRoute>} />
          <Route path="/planner/*" element={<PrivateRoute roles={['planner','administrator']}><PlannerDashboard /></PrivateRoute>} />
          <Route path="/supervisor/*" element={<PrivateRoute roles={['area_supervisor','administrator']}><SupervisorDashboard /></PrivateRoute>} />
          <Route path="/shift/*" element={<PrivateRoute roles={['shift_responsible','administrator']}><ShiftDashboard /></PrivateRoute>} />
          <Route path="/operator/*" element={<PrivateRoute roles={['operator','administrator']}><OperatorDashboard /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
