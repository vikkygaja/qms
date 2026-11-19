import { get, patch, post, put } from './client';
import type { AuditEntry, Page, Permission, Role, User, UserWithPassword } from './types';

export interface UserListParams {
  q?: string;
  status?: string;
  role_id?: string;
  page?: number;
  page_size?: number;
}
export interface NewUser {
  employee_id: string;
  full_name: string;
  designation: string;
  role_id: string;
  mobile: string;
  email?: string;
}
export type UserChanges = Partial<Omit<NewUser, 'employee_id'>>;

export const listUsers = (p: UserListParams) => get<Page<User>>('/users', { ...p });
export const createUser = (u: NewUser) => post<UserWithPassword>('/users', u);
export const updateUser = (id: string, c: UserChanges) => patch<User>(`/users/${id}`, c);
export const setUserStatus = (id: string, status: 'Active' | 'Inactive', reason: string) =>
  post<User>(`/users/${id}/status`, { status, reason });
export const resetPassword = (id: string) => post<UserWithPassword>(`/users/${id}/reset-password`);

export const listPermissions = () => get<Permission[]>('/permissions');
export const listRoles = () => get<Role[]>('/roles');
export const createRole = (name: string) => post<Role>('/roles', { name });
export const setRolePermissions = (id: string, permissions: string[]) =>
  put<Role>(`/roles/${id}/permissions`, { permissions });

export interface AuditParams {
  entity?: string;
  action?: string;
  actor_id?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  page?: number;
  page_size?: number;
}
export const listAudit = (p: AuditParams) => get<Page<AuditEntry>>('/audit-log', { ...p });
