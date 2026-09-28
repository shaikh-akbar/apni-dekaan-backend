// Single source of truth for permission keys. Seeded into the `permissions` table.
export const PERMISSIONS = [
  { key: 'dashboard.view', name: 'View dashboard', group: 'Dashboard' },
  { key: 'customers.view', name: 'View customers', group: 'Customers' },
  { key: 'customers.create', name: 'Create customers', group: 'Customers' },
  { key: 'customers.edit', name: 'Edit customers', group: 'Customers' },
  { key: 'purchases.view', name: 'View purchases', group: 'Purchases' },
  { key: 'purchases.create', name: 'Add purchases', group: 'Purchases' },
  { key: 'purchases.edit', name: 'Edit purchases', group: 'Purchases' },
  { key: 'purchases.cancel', name: 'Cancel purchases', group: 'Purchases' },
  { key: 'loyalty.view', name: 'View loyalty history', group: 'Loyalty' },
  { key: 'loyalty.recalculate', name: 'Run loyalty recalculation', group: 'Loyalty' },
  { key: 'rewards.view', name: 'View rewards', group: 'Rewards' },
  { key: 'rewards.manage', name: 'Create / edit rewards', group: 'Rewards' },
  { key: 'rewards.process', name: 'Process reward claims', group: 'Rewards' },
  { key: 'reports.view', name: 'View & export reports', group: 'Reports' },
  { key: 'settings.manage', name: 'Manage settings', group: 'Settings' },
  { key: 'staff.manage', name: 'Manage staff & roles', group: 'Settings' },
  { key: 'audit.view', name: 'View audit log', group: 'Settings' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export const DEFAULT_STAFF_PERMISSIONS = [
  'dashboard.view',
  'customers.view',
  'customers.create',
  'purchases.view',
  'purchases.create',
  'loyalty.view',
  'rewards.view',
  'rewards.process',
];

export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';
