import { listStaffCategories } from '../../../api/masters';
import type { StaffCategory } from '../../../api/types';
import { MasterListPage, type MasterListConfig } from './MasterListPage';
import s from './masters.module.css';

const CFG: MasterListConfig<StaffCategory> = {
  kind: 'staff-categories',
  title: 'Staff categories',
  singular: 'staff category',
  plural: 'staff categories',
  description:
    'Kinds of staff whose hand hygiene is observed. The code appears on the printable observation sheet.',
  fetchList: listStaffCategories,
  sortKeys: { name: 'name', status: 'status' },
  columns: [
    { key: 'name', header: 'Category', sortKey: 'name', render: (c) => <strong>{c.name}</strong> },
    {
      key: 'code',
      header: 'Code',
      sortKey: 'code',
      render: (c) => <code className={s.chip}>{c.code}</code>,
    },
  ],
  inactiveEffect:
    'This category will no longer appear on entry screens or the printable sheet. Past records keep it.',
  activeEffect: 'This category will appear on entry screens again.',
  firstTimeText: 'Add the staff categories that are observed, each with a short code.',
};

export function StaffCategoriesPage() {
  return <MasterListPage cfg={CFG} />;
}
