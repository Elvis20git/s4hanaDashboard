/* The permission model on the front end — mirrors backend/analytics/auth/permissions.py (the single source of truth). Dashboard keys,
   labels, routes, presets and the password rules are defined here once; no other file spells them out. */
export const DASHBOARDS = [
  { key: 'sales', label: 'Sales', route: 'overview', icon: 'trendingUp' },
  { key: 'production', label: 'Production', route: 'production', icon: 'factory' },
  { key: 'ar_ap_aging', label: 'AR & AP aging', route: 'ar-ap-aging', icon: 'clock' },
  { key: 'inventory', label: 'Inventory', route: 'inventory', icon: 'layers' },
  { key: 'goods_in_transit', label: 'Goods in transit', route: 'goods-in-transit', icon: 'truck' },
  { key: 'tax', label: 'Tax', route: 'tax', icon: 'fileText' },
  { key: 'data_management', label: 'Data Mgmt', route: 'data', icon: 'database' },
];
export const DASHBOARD_KEYS = DASHBOARDS.map(d => d.key);
export const PRESETS = {
  finance: ['sales', 'ar_ap_aging', 'tax'],
  operations: ['production', 'inventory', 'goods_in_transit'],
};
export const ROLES = [
  { key: 'SUPERUSER', label: 'Superuser' },
  { key: 'ANALYST', label: 'Analyst' },
  { key: 'VIEWER', label: 'Viewer' },
];
export const roleLabel = k => (ROLES.find(r => r.key === k) || { label: k }).label;
export const ADMIN_ROUTE = 'admin';          // Administration is never a grantable dashboard: SUPERUSER only

export const routeToKey = route => (DASHBOARDS.find(d => d.route === route) || {}).key || null;
export const keyToRoute = key => (DASHBOARDS.find(d => d.key === key) || {}).route || null;
export const dashboardLabel = key => (DASHBOARDS.find(d => d.key === key) || { label: key }).label;

/** The live strength checklist (same rules the API enforces). */
export const passwordRules = pw => [
  { id: 'len', label: '8+ characters', ok: (pw || '').length >= 8 },
  { id: 'up', label: 'Uppercase letter', ok: /[A-Z]/.test(pw || '') },
  { id: 'low', label: 'Lowercase letter', ok: /[a-z]/.test(pw || '') },
  { id: 'num', label: 'Number', ok: /\d/.test(pw || '') },
  { id: 'sp', label: 'Special character', ok: /[^A-Za-z0-9]/.test(pw || '') },
];
export const passwordOk = pw => passwordRules(pw).every(r => r.ok);
