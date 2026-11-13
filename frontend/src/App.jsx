import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import PlannerDashboard from './pages/planner/PlannerDashboard';
import SupervisorDashboard from './pages/supervisor/SupervisorDashboard';
import ShiftDashboard from './pages/shift/ShiftDashboard';
import OperatorDashboard from './pages/operator/OperatorDashboard';
import ItemsManager from './pages/planner/ItemsManager';
import SupplierManager from './pages/inventory/SupplierManager';
import BOMViewerPage from './pages/planner/BOMViewerPage';
import OEEPage from './pages/analytics/OEEPage';
import InventoryPage from './pages/inventory/InventoryPage';
import MaintenancePage from './pages/maintenance/MaintenancePage';
import SalesLayout from './pages/sales/SalesLayout';
import DocumentsList from './pages/sales/DocumentsList';
import DocumentEditor from './pages/sales/DocumentEditor';
import CustomersPage from './pages/sales/CustomersPage';
import SettingsPage from './pages/sales/SettingsPage';
import IncomingInvoicesPage from './pages/sales/IncomingInvoicesPage';
import { OpenItemsPage, DunningPage, DatevPage } from './pages/sales/OpenItemsPage';
import './index.css';

const ROLE_ROUTES = {
  administrator: '/admin',
  planner: '/planner',
  area_supervisor: '/supervisor',
  shift_responsible: '/shift',
  operator: '/operator',
  warehouse_manager: '/inventory',
  material_planner: '/inventory',
  sales: '/sales/documents',
  accounting: '/sales/open-items',
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
      <SocketProvider>
        <BrowserRouter>
          <Toaster position="top-right" toastOptions={{ style: { background: '#1a2235', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.1)' } }} />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<RootRedirect />} />
            
            {/* Admin */}
            <Route path="/admin/*" element={<PrivateRoute roles={['administrator']}><AdminDashboard /></PrivateRoute>} />
            
            {/* Planner */}
            <Route path="/planner/*" element={<PrivateRoute roles={['planner','administrator']}><PlannerDashboard /></PrivateRoute>} />
            <Route path="/planner/items" element={<PrivateRoute roles={['planner','administrator']}><ItemsManager /></PrivateRoute>} />
            <Route path="/planner/suppliers" element={<PrivateRoute roles={['planner','administrator']}><SupplierManager /></PrivateRoute>} />
            <Route path="/planner/boms/:id" element={<PrivateRoute roles={['planner','administrator']}><BOMViewerPage /></PrivateRoute>} />
            <Route path="/planner/inventory" element={<PrivateRoute roles={['planner','administrator']}><InventoryPage /></PrivateRoute>} />
            <Route path="/inventory" element={<PrivateRoute roles={['warehouse_manager', 'material_planner', 'administrator']}><InventoryPage /></PrivateRoute>} />
            <Route path="/inventory/suppliers" element={<PrivateRoute roles={['warehouse_manager', 'material_planner', 'administrator']}><SupplierManager /></PrivateRoute>} />
            
            {/* Sales & invoicing */}
            <Route path="/sales" element={<PrivateRoute roles={['administrator', 'sales', 'accounting', 'planner']}><SalesLayout /></PrivateRoute>}>
              <Route index element={<Navigate to="/sales/documents" replace />} />
              <Route path="documents" element={<DocumentsList />} />
              <Route path="documents/:id" element={<DocumentEditor />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="open-items" element={<OpenItemsPage />} />
              <Route path="dunning" element={<PrivateRoute roles={['administrator', 'accounting']}><DunningPage /></PrivateRoute>} />
              <Route path="datev" element={<PrivateRoute roles={['administrator', 'accounting']}><DatevPage /></PrivateRoute>} />
            </Route>
            <Route path="/settings" element={<PrivateRoute roles={['administrator']}><SalesLayout /></PrivateRoute>}>
              <Route index element={<SettingsPage />} />
            </Route>
            <Route path="/purchase-invoices" element={<PrivateRoute roles={['administrator', 'accounting', 'material_planner', 'planner', 'warehouse_manager']}><SalesLayout /></PrivateRoute>}>
              <Route index element={<IncomingInvoicesPage />} />
            </Route>

            {/* Supervisor */}
            <Route path="/supervisor/*" element={<PrivateRoute roles={['area_supervisor','administrator']}><SupervisorDashboard /></PrivateRoute>} />
            <Route path="/supervisor/oee" element={<PrivateRoute roles={['area_supervisor','administrator']}><OEEPage /></PrivateRoute>} />
            <Route path="/supervisor/maintenance" element={<PrivateRoute roles={['area_supervisor','administrator']}><MaintenancePage /></PrivateRoute>} />
            
            {/* Shift Responsible */}
            <Route path="/shift/*" element={<PrivateRoute roles={['shift_responsible','administrator']}><ShiftDashboard /></PrivateRoute>} />
            
            {/* Operator */}
            <Route path="/operator/*" element={<PrivateRoute roles={['operator','administrator']}><OperatorDashboard /></PrivateRoute>} />
            
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}
