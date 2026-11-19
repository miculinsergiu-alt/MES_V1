/**
 * Central navigation and access rules.
 *
 * One list for the whole app: the sidebar shows only entries the user's role
 * may open, and the router uses the same roles to guard the pages. The
 * server enforces its own checks independently.
 */
import {
  Home, Clock, Layers, LayoutDashboard, Factory, ClipboardList, HardHat, Gauge, Wrench, Boxes, Truck, Users, Warehouse,
  Inbox, ArrowRightLeft, FileText, Wallet, BellRing, FileDown, Settings, ShieldCheck, Upload, GitBranch, Calculator, BarChart3,
} from 'lucide-react';
import { rolesOf } from './lib/roles';

const ALL = ['administrator', 'planner', 'area_supervisor', 'shift_responsible', 'operator', 'warehouse_manager', 'material_planner', 'sales', 'accounting'];

export const NAV_GROUPS = [
  {
    key: 'overview',
    items: [
      { path: '/home', key: 'home', icon: Home, roles: ALL },
      { path: '/time', key: 'time', icon: Clock, roles: ALL },
    ],
  },
  {
    key: 'production',
    items: [
      { path: '/planner', key: 'production_plan', icon: LayoutDashboard, roles: ['planner', 'administrator'] },
      { path: '/supervisor', key: 'control_room', icon: Factory, roles: ['area_supervisor', 'administrator'] },
      { path: '/shift', key: 'shift', icon: ClipboardList, roles: ['shift_responsible', 'administrator'] },
      { path: '/operator', key: 'my_tasks', icon: HardHat, roles: ['operator', 'administrator'] },
      { path: '/supervisor/oee', key: 'oee', icon: Gauge, roles: ['area_supervisor', 'administrator', 'planner'] },
      { path: '/supervisor/maintenance', key: 'maintenance', icon: Wrench, roles: ['area_supervisor', 'administrator'] },
    ],
  },
  {
    key: 'master_data',
    items: [
      { path: '/planner/items', key: 'items_boms', icon: Boxes, roles: ['planner', 'administrator'] },
      { path: '/sales/customers', key: 'customers', icon: Users, roles: ['administrator', 'sales', 'accounting', 'planner'] },
      { path: '/inventory/suppliers', key: 'suppliers', icon: Truck, roles: ['warehouse_manager', 'material_planner', 'planner', 'administrator', 'accounting'] },
    ],
  },
  {
    key: 'warehouse',
    items: [
      { path: '/inventory', key: 'inventory', icon: Warehouse, roles: ['warehouse_manager', 'material_planner', 'planner', 'administrator'] },
      { path: '/subcontracting', key: 'subcontracting', icon: ArrowRightLeft, roles: ['administrator', 'planner', 'material_planner', 'warehouse_manager', 'area_supervisor', 'shift_responsible', 'accounting'] },
      { path: '/quality', key: 'quality', icon: ShieldCheck, roles: ['administrator', 'planner', 'area_supervisor', 'warehouse_manager', 'material_planner', 'sales'] },
      { path: '/purchase-invoices', key: 'incoming_invoices', icon: Inbox, roles: ['administrator', 'accounting', 'material_planner', 'planner', 'warehouse_manager'] },
      { path: '/trace', key: 'traceability', icon: GitBranch, roles: ['administrator', 'planner', 'area_supervisor', 'shift_responsible', 'warehouse_manager', 'material_planner', 'sales'] },
    ],
  },
  {
    key: 'sales',
    items: [
      { path: '/sales/documents', key: 'documents', icon: FileText, roles: ['administrator', 'sales', 'accounting', 'planner'] },
      { path: '/sales/blanket-orders', key: 'blanket_orders', icon: Layers, roles: ['administrator', 'sales', 'accounting', 'planner'] },
      { path: '/sales/open-items', key: 'open_items', icon: Wallet, roles: ['administrator', 'sales', 'accounting', 'planner'] },
      { path: '/sales/dunning', key: 'dunning', icon: BellRing, roles: ['administrator', 'accounting'] },
      { path: '/sales/datev', key: 'datev', icon: FileDown, roles: ['administrator', 'accounting'] },
    ],
  },
  {
    key: 'analysis',
    items: [
      { path: '/reports', key: 'reports', icon: BarChart3, roles: ['administrator', 'planner', 'accounting', 'sales', 'warehouse_manager', 'material_planner'] },
      { path: '/costing', key: 'costing', icon: Calculator, roles: ['administrator', 'planner', 'accounting'] },
    ],
  },
  {
    key: 'admin',
    items: [
      { path: '/admin', key: 'users_machines', icon: ShieldCheck, roles: ['administrator'] },
      { path: '/import', key: 'import', icon: Upload, roles: ['administrator', 'planner', 'sales', 'accounting', 'material_planner', 'warehouse_manager'] },
      { path: '/settings', key: 'settings', icon: Settings, roles: ['administrator'] },
    ],
  },
];

/** Roles that may open a path (longest matching entry wins). */
export function rolesFor(path) {
  let best = null;
  for (const g of NAV_GROUPS) {
    for (const item of g.items) {
      const match = path === item.path || path.startsWith(`${item.path}/`);
      if (match && (!best || item.path.length > best.path.length)) best = item;
    }
  }
  return best?.roles ?? null;
}

/** Navigation groups visible for a user (union of all their roles). */
export function navFor(user) {
  const mine = rolesOf(user);
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => i.roles.some((r) => mine.includes(r))) }))
    .filter((g) => g.items.length);
}

/** Where a user lands after login. Shop-floor roles go straight to their work. */
export const HOME_BY_ROLE = {
  operator: '/operator',
  shift_responsible: '/shift',
};
/** Users with only shop-floor roles land on their work; everyone else on the dashboard. */
export const homeFor = (user) => {
  const mine = rolesOf(user);
  return mine.length === 1 && HOME_BY_ROLE[mine[0]] ? HOME_BY_ROLE[mine[0]] : '/home';
};
