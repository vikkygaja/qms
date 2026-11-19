export interface RoleRef {
  id: string;
  key: string;
  name: string;
}

export interface Me {
  id: string;
  employee_id: string;
  full_name: string;
  designation: string;
  role: RoleRef;
  permissions: string[];
  must_change_password: boolean;
}

export interface SessionResponse {
  user: Me;
  csrf_token: string;
}

export interface User {
  id: string;
  employee_id: string;
  full_name: string;
  designation: string;
  mobile: string;
  email: string;
  role: RoleRef;
  status: 'Active' | 'Inactive';
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface UserWithPassword {
  user: User;
  temporary_password: string;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  is_system: boolean;
  permissions: string[];
  active_user_count: number;
}

export interface Permission {
  code: string;
  description: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: { id: string; employee_id: string; full_name: string } | null;
  entity: string;
  entity_id: string;
  action: string;
  summary: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}
