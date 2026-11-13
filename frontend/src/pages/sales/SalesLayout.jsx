import { Outlet } from 'react-router-dom';
import { FileText, Users, Wallet, BellRing, FileDown, Settings, Factory, Inbox } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import { useAuth } from '../../contexts/AuthContext';
import { ACCOUNTING_ROLES, SALES_AREA_ROLES, INCOMING_ROLES } from '../../lib/roles';

const HOME_BY_ROLE = { administrator: '/admin', planner: '/planner', material_planner: '/inventory', warehouse_manager: '/inventory' };

export default function SalesLayout() {
  const { user } = useAuth();
  const role = user?.role;
  const items = [];
  if (SALES_AREA_ROLES.includes(role)) {
    items.push(
      { path: '/sales/documents', labelKey: 'sales.nav.documents', icon: <FileText size={18} /> },
      { path: '/sales/customers', labelKey: 'sales.nav.customers', icon: <Users size={18} /> },
      { path: '/sales/open-items', labelKey: 'sales.nav.open_items', icon: <Wallet size={18} /> },
    );
  }
  if (INCOMING_ROLES.includes(role)) items.push({ path: '/purchase-invoices', labelKey: 'sales.nav.incoming', icon: <Inbox size={18} /> });
  if (ACCOUNTING_ROLES.includes(role)) {
    items.push(
      { path: '/sales/dunning', labelKey: 'sales.nav.dunning', icon: <BellRing size={18} /> },
      { path: '/sales/datev', labelKey: 'sales.nav.datev', icon: <FileDown size={18} /> },
    );
  }
  if (role === 'administrator') items.push({ path: '/settings', labelKey: 'sales.nav.settings', icon: <Settings size={18} /> });
  if (HOME_BY_ROLE[role]) items.push({ path: HOME_BY_ROLE[role], labelKey: 'sales.nav.back', icon: <Factory size={18} /> });

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar items={items} />
      <main className="flex-1 p-6 lg:p-10 overflow-auto min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
