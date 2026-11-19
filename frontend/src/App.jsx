import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import AppShell from './components/AppShell';
import { homeFor } from './navigation';
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
import DocumentsList from './pages/sales/DocumentsList';
import DocumentEditor from './pages/sales/DocumentEditor';
import CustomersPage from './pages/sales/CustomersPage';
import SettingsPage from './pages/sales/SettingsPage';
import IncomingInvoicesPage from './pages/sales/IncomingInvoicesPage';
import { OpenItemsPage, DunningPage, DatevPage } from './pages/sales/OpenItemsPage';
import HomePage from './pages/HomePage';
import ImportPage from './pages/ImportPage';
import SignupPage from './pages/SignupPage';
import SetupWizard from './pages/SetupWizard';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/AccountPages';
import AccountSecurityPage from './pages/AccountSecurityPage';
import './index.css';
import TracePage from './pages/ops/TracePage';
import CostingPage from './pages/ops/CostingPage';
import ReportsPage from './pages/ops/ReportsPage';

function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user)} replace />;
}

/** Standard page padding for the newer screens. */
function Padded() {
  return <div className="p-4 sm:p-6 lg:p-10"><Outlet /></div>;
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
          <Toaster position="top-right" toastOptions={{ style: { background: '#1a2235', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.1)' } }} />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/setup" element={<SetupWizard />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/" element={<RootRedirect />} />

            {/* Everything after login lives in one shell; access is checked there (navigation.js). */}
            <Route element={<AppShell />}>
              {/* Own account (every role) */}
              <Route path="/account" element={<AccountSecurityPage />} />

              {/* Production */}
              <Route path="/admin/*" element={<AdminDashboard />} />
              <Route path="/planner/items" element={<ItemsManager />} />
              <Route path="/planner/boms/:id" element={<BOMViewerPage />} />
              <Route path="/planner/*" element={<PlannerDashboard />} />
              <Route path="/supervisor/oee" element={<OEEPage />} />
              <Route path="/supervisor/maintenance" element={<MaintenancePage />} />
              <Route path="/supervisor/*" element={<SupervisorDashboard />} />
              <Route path="/shift/*" element={<ShiftDashboard />} />
              <Route path="/operator/*" element={<OperatorDashboard />} />

              {/* Warehouse & purchasing */}
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/inventory/suppliers" element={<SupplierManager />} />

              <Route element={<Padded />}>
                <Route path="/home" element={<HomePage />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/purchase-invoices" element={<IncomingInvoicesPage />} />
                {/* Sales & invoicing */}
                <Route path="/sales" element={<Navigate to="/sales/documents" replace />} />
                <Route path="/sales/documents" element={<DocumentsList />} />
                <Route path="/sales/documents/:id" element={<DocumentEditor />} />
                <Route path="/sales/customers" element={<CustomersPage />} />
                <Route path="/sales/open-items" element={<OpenItemsPage />} />
                <Route path="/sales/dunning" element={<DunningPage />} />
                <Route path="/sales/datev" element={<DatevPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/trace" element={<TracePage />} />
                <Route path="/trace/:lot" element={<TracePage />} />
                <Route path="/costing" element={<CostingPage />} />
                <Route path="/costing/:id" element={<CostingPage />} />
                <Route path="/reports" element={<ReportsPage />} />
              </Route>
            </Route>

            {/* Old addresses */}
            <Route path="/planner/inventory" element={<Navigate to="/inventory" replace />} />
            <Route path="/planner/suppliers" element={<Navigate to="/inventory/suppliers" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}
