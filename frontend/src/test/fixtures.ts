import type { AuditEntry, Me, Permission, Role, User } from '../api/types';

export const ALL_PERMS = [
  'masters',
  'users',
  'ln',
  'record',
  'review',
  'targets',
  'dash',
  'alerts',
  'reports',
];

export const PERMISSIONS: Permission[] = [
  { code: 'masters', description: 'Manage masters' },
  { code: 'users', description: 'Manage users and roles' },
  { code: 'ln', description: 'Manage link nurses' },
  { code: 'record', description: 'Record sessions' },
  { code: 'review', description: 'Review sessions' },
  { code: 'targets', description: 'Set ward targets' },
  { code: 'dash', description: 'View dashboard' },
  { code: 'alerts', description: 'Receive low-compliance alerts' },
  { code: 'reports', description: 'Use reports centre' },
];

export const adminMe: Me = {
  id: 'u-admin',
  employee_id: 'ADMIN',
  full_name: 'Test Admin',
  designation: 'IT Administrator',
  role: { id: 'r-admin', key: 'admin', name: 'Admin' },
  permissions: ALL_PERMS,
  must_change_password: false,
};
export const icnMe: Me = {
  ...adminMe,
  id: 'u-icn',
  employee_id: 'ICN001',
  full_name: 'Test ICN',
  role: { id: 'r-icn', key: 'icn', name: 'ICN' },
  permissions: ['ln', 'record', 'review', 'targets', 'dash', 'alerts', 'reports'],
};
export const nurseMe: Me = {
  ...adminMe,
  id: 'u-ln',
  employee_id: 'LN001',
  full_name: 'Test Nurse',
  role: { id: 'r-ln', key: 'link_nurse', name: 'Link nurse' },
  permissions: ['record', 'dash'],
};

export const ROLES: Role[] = [
  {
    id: 'r-admin',
    key: 'admin',
    name: 'Admin',
    is_system: true,
    permissions: ALL_PERMS,
    active_user_count: 1,
  },
  {
    id: 'r-icn',
    key: 'icn',
    name: 'ICN',
    is_system: true,
    permissions: ['ln', 'record', 'dash'],
    active_user_count: 2,
  },
  {
    id: 'r-ln',
    key: 'link_nurse',
    name: 'Link nurse',
    is_system: true,
    permissions: ['record', 'dash'],
    active_user_count: 5,
  },
];

export const makeUser = (over: Partial<User> = {}): User => ({
  id: 'u1',
  employee_id: 'ICN001',
  full_name: 'Test ICN',
  designation: 'Infection Control Nurse',
  mobile: '9840000002',
  email: '',
  role: { id: 'r-icn', key: 'icn', name: 'ICN' },
  status: 'Active',
  must_change_password: false,
  last_login_at: null,
  created_at: '2026-11-01T00:00:00Z',
  ...over,
});

export const makeAudit = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 1,
  at: '2026-11-19T10:00:00Z',
  actor: { id: 'u-admin', employee_id: 'ADMIN', full_name: 'Test Admin' },
  entity: 'user',
  entity_id: 'u1',
  action: 'create',
  summary: 'Created user Test ICN (ICN001) as ICN',
  old_values: null,
  new_values: null,
  ...over,
});

export const page = <T>(items: T[], extra: Partial<{ total: number; page: number }> = {}) => ({
  items,
  total: extra.total ?? items.length,
  page: extra.page ?? 1,
  page_size: 25,
});

export const DEPT_ICU = {
  id: 'd1',
  name: 'Critical Care',
  status: 'Active' as const,
  ward_count: 1,
};
export const DEPT_GEN = {
  id: 'd2',
  name: 'General Medicine',
  status: 'Active' as const,
  ward_count: 0,
};
export const WARD_MICU = {
  id: 'w1',
  name: 'MICU',
  department: { id: 'd1', name: 'Critical Care' },
  monthly_target: 65,
  status: 'Active' as const,
};
export const CAT_DOCTOR = { id: 'c1', name: 'Doctor', code: 'D', status: 'Active' as const };
export const CAT_NURSE = { id: 'c2', name: 'Nurse', code: 'N', status: 'Active' as const };

export const SUMMARY = {
  departments: { active: 11, inactive: 1 },
  wards: { active: 20, inactive: 2, monthly_target_total: 1000 },
  staff_categories: { active: 6, inactive: 0 },
  kpi: { green: 90, amber: 80, inactive_days: 10 },
};
