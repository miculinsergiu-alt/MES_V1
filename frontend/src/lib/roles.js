// Roles allowed to do things in the sales & invoicing area (the server enforces the same rules).
export const ACCOUNTING_ROLES = ['administrator', 'accounting'];
export const EDIT_ROLES = ['administrator', 'sales', 'accounting'];
export const SALES_AREA_ROLES = ['administrator', 'sales', 'accounting', 'planner'];
export const INCOMING_ROLES = ['administrator', 'accounting', 'material_planner', 'planner', 'warehouse_manager'];

/** All roles of a user (older sessions only carry "role"). */
export const rolesOf = (user) => (Array.isArray(user?.roles) && user.roles.length ? user.roles : user?.role ? [user.role] : []);
/** True if the user has at least one of the given roles. */
export const hasAnyRole = (user, roles) => rolesOf(user).some((r) => roles.includes(r));
