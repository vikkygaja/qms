import { get, patch, post, put } from './client';
import type {
  AuditEntry,
  ItemStatus,
  LinkNurse,
  LinkNurseDetail,
  LinkNurseWithPassword,
  Page,
} from './types';

export interface LinkNurseListParams {
  q?: string;
  ward_id?: string;
  status?: ItemStatus | '';
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}
export interface NewLinkNurse {
  employee_id: string;
  full_name: string;
  designation: string;
  department_id: string;
  mobile: string;
  email?: string;
  link_nurse_from: string;
  who5_training_date?: string;
  ward_ids: string[];
}
export interface LinkNurseChanges {
  full_name?: string;
  designation?: string;
  department_id?: string;
  mobile?: string;
  email?: string;
  link_nurse_from?: string;
  who5_training_date?: string | null;
}

export const listLinkNurses = (p: LinkNurseListParams = {}) =>
  get<Page<LinkNurse>>('/link-nurses', { ...p });
export const createLinkNurse = (b: NewLinkNurse) => post<LinkNurseWithPassword>('/link-nurses', b);
export const getLinkNurse = (id: string) => get<LinkNurseDetail>(`/link-nurses/${id}`);
export const updateLinkNurse = (id: string, c: LinkNurseChanges) =>
  patch<LinkNurseDetail>(`/link-nurses/${id}`, c);
export const setLinkNurseWards = (id: string, ward_ids: string[]) =>
  put<LinkNurseDetail>(`/link-nurses/${id}/wards`, { ward_ids });
export const setLinkNurseStatus = (
  id: string,
  status: ItemStatus,
  reason: string,
  effective_date?: string,
) => post<LinkNurseDetail>(`/link-nurses/${id}/status`, { status, reason, effective_date });
export const resetLinkNursePassword = (id: string) =>
  post<LinkNurseWithPassword>(`/link-nurses/${id}/reset-password`);
export const listRecentLinkNurseChanges = (limit = 8) =>
  get<AuditEntry[]>('/link-nurses/recent-changes', { limit });
