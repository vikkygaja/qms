import { Link } from 'react-router-dom';
import { listDepartments } from '../../../api/masters';
import type { Department } from '../../../api/types';
import { MasterListPage, type MasterListConfig } from './MasterListPage';
import s from './masters.module.css';

const CFG: MasterListConfig<Department> = {
  kind: 'departments',
  title: 'Departments',
  singular: 'department',
  plural: 'departments',
  description: 'Where observations are recorded: each ward belongs to one department.',
  fetchList: listDepartments,
  sortKeys: { name: 'name', status: 'status' },
  columns: [
    {
      key: 'name',
      header: 'Department',
      sortKey: 'name',
      render: (d) => <strong>{d.name}</strong>,
    },
    {
      key: 'wards',
      header: 'Wards',
      sortKey: 'ward_count',
      align: 'right',
      render: (d) =>
        d.ward_count > 0 ? (
          <Link
            className={s.link}
            to={`/admin/masters/wards?department_id=${d.id}`}
            aria-label={`View ${d.ward_count} ${d.ward_count === 1 ? 'ward' : 'wards'} in ${d.name}`}
          >
            {d.ward_count}
          </Link>
        ) : (
          '0'
        ),
    },
  ],
  inactiveEffect:
    'This department can no longer be chosen for new wards. Its existing wards and past records are not changed.',
  activeEffect: 'This department can be chosen for new wards again.',
  firstTimeText: 'Add departments first, then add wards under them.',
};

export function DepartmentsPage() {
  return <MasterListPage cfg={CFG} />;
}
