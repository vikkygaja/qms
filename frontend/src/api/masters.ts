import { get, patch, post, put, upload, type Query } from './client';
import type {
  Department,
  ExportKind,
  ImportReport,
  ItemStatus,
  KpiSettings,
  MasterKind,
  MastersSummary,
  Page,
  StaffCategory,
  Ward,
} from './types';

export interface MasterListParams {
  status?: ItemStatus | '';
  q?: string;
  page?: number;
  page_size?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  department_id?: string; // wards only
}
export interface NewDepartment {
  name: string;
}
export interface NewWard {
  name: string;
  department_id: string;
  monthly_target: number;
}
export interface NewStaffCategory {
  name: string;
  code: string;
}

export type FileFormat = 'xlsx' | 'csv';

const list =
  <T>(kind: MasterKind) =>
  (p: MasterListParams = {}) =>
    get<Page<T>>(`/${kind}`, { ...p } as Query);

export const listDepartments = list<Department>('departments');
export const listWards = list<Ward>('wards');
export const listStaffCategories = list<StaffCategory>('staff-categories');

export const createMaster = <T>(kind: MasterKind, body: object) => post<T>(`/${kind}`, body);
export const updateMaster = <T>(kind: MasterKind, id: string, body: object) =>
  patch<T>(`/${kind}/${id}`, body);
export const setMasterStatus = <T>(
  kind: MasterKind,
  id: string,
  status: ItemStatus,
  reason: string,
) => post<T>(`/${kind}/${id}/status`, { status, reason });

export const getMastersSummary = () => get<MastersSummary>('/masters/summary');

export const getKpiSettings = () => get<KpiSettings>('/settings/kpi');
export const saveKpiSettings = (s: KpiSettings) => put<KpiSettings>('/settings/kpi', s);

/** Download URLs: used as plain anchors; the same-origin cookie is sent and the server names the file. */
export const exportUrl = (kind: ExportKind, format: FileFormat) =>
  `/api/v1/masters/export?kind=${kind}&format=${format}`;
export const templateUrl = (kind: ExportKind, format: FileFormat) =>
  `/api/v1/masters/template?kind=${kind}&format=${format}`;

export function importMasters(file: File, kind: ExportKind, dryRun: boolean) {
  const form = new FormData();
  form.append('file', file);
  return upload<ImportReport>('/masters/import', form, {
    kind,
    dry_run: dryRun ? 'true' : 'false',
  });
}
