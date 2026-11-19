import { useQuery } from '@tanstack/react-query';
import { getMastersSummary, listDepartments, listWards } from '../../../api/masters';
import type { Ward } from '../../../api/types';
import { Skeleton } from '../../../components/Skeleton';
import { MasterListPage, type MasterListConfig } from './MasterListPage';
import s from './masters.module.css';

const fmt = (n: number) => n.toLocaleString('en-IN');

function SummaryStrip() {
  const sum = useQuery({ queryKey: ['masters', 'summary'], queryFn: getMastersSummary });
  const w = sum.data?.wards;
  const stat = (label: string, value: number | undefined) => (
    <div className={s.stat}>
      <dt>{label}</dt>
      <dd>{value === undefined ? <Skeleton width={60} height={26} /> : fmt(value)}</dd>
    </div>
  );
  return (
    <dl className={s.strip} aria-label="Ward summary">
      {stat('Active wards', w?.active)}
      {stat('Inactive wards', w?.inactive)}
      {stat('Monthly target (active wards)', w?.monthly_target_total)}
    </dl>
  );
}

function DepartmentFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string | undefined) => void;
}) {
  const depts = useQuery({
    queryKey: ['masters', 'departments', 'filter-options'],
    queryFn: () => listDepartments({ page_size: 500 }),
  });
  return (
    <label className="f" htmlFor="f-dept">
      Department
      <select id="f-dept" value={value} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">All departments</option>
        {(depts.data?.items ?? []).map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
            {d.status === 'Inactive' ? ' (inactive)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

const CFG: MasterListConfig<Ward> = {
  kind: 'wards',
  title: 'Wards',
  singular: 'ward',
  plural: 'wards',
  description:
    'Wards and units where hand hygiene is observed. Each belongs to a department and has a monthly target.',
  fetchList: listWards,
  sortKeys: { name: 'name', status: 'status' },
  extraKeys: ['department_id'],
  columns: [
    { key: 'name', header: 'Ward', sortKey: 'name', render: (w) => <strong>{w.name}</strong> },
    {
      key: 'dept',
      header: 'Department',
      sortKey: 'department',
      render: (w) => w.department.name,
    },
    {
      key: 'target',
      header: 'Monthly target',
      sortKey: 'monthly_target',
      align: 'right',
      render: (w) => fmt(w.monthly_target),
    },
    {
      key: 'ln',
      header: 'Link nurses',
      align: 'right',
      render: (w) => fmt(w.link_nurse_count),
    },
  ],
  inactiveEffect:
    'This ward will no longer appear on entry screens. Past sessions and reports keep it. You can make it active again later. A ward with link nurses assigned cannot be made inactive until they are moved.',
  activeEffect: 'This ward will appear on entry screens again.',
  firstTimeText: 'Add wards one by one, or import them from an Excel file.',
  above: <SummaryStrip />,
  extraFilters: (state, set) => (
    <DepartmentFilter
      value={state.extra.department_id ?? ''}
      onChange={(v) => set({ department_id: v })}
    />
  ),
};

export function WardsPage() {
  return <MasterListPage cfg={CFG} />;
}
