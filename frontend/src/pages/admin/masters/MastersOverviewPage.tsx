import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../../api/client';
import { getMastersSummary } from '../../../api/masters';
import { PageHeader } from '../../../components/PageHeader';
import { Skeleton } from '../../../components/Skeleton';
import s from './masters.module.css';

const fmt = (n: number) => n.toLocaleString('en-IN');

function MasterCard({
  to,
  title,
  helper,
  children,
}: {
  to: string;
  title: string;
  helper: string;
  children?: ReactNode;
}) {
  return (
    <article className={s.mcard}>
      <h2>
        <Link to={to}>{title}</Link>
      </h2>
      <p className={s.helper}>{helper}</p>
      {children}
    </article>
  );
}

function Counts({ n, noun, inactive }: { n: number; noun: string; inactive: number }) {
  return (
    <>
      <p className={s.big}>{fmt(n)}</p>
      <p className={s.meta}>
        active {noun} · {fmt(inactive)} inactive
      </p>
    </>
  );
}

export function MastersOverviewPage() {
  const sum = useQuery({ queryKey: ['masters', 'summary'], queryFn: getMastersSummary });
  const d = sum.data;
  return (
    <div className={s.page}>
      <PageHeader
        title="Masters"
        description="Shared lists used by every QMS module. Nothing is deleted: inactive items disappear from entry screens but stay in past records."
      />
      {sum.isError && (
        <div className={s.err}>
          <p role="alert" className="err">
            {sum.error instanceof ApiError ? sum.error.message : 'Could not load the summary.'}
          </p>
          <button type="button" className="btn ghost sm" onClick={() => void sum.refetch()}>
            Try again
          </button>
        </div>
      )}
      {sum.isPending && (
        <div className={s.cards} role="status">
          <span className="sr-only">Loading summary…</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={s.mcard}>
              <Skeleton width="50%" height={18} />
              <Skeleton height={12} />
              <Skeleton width={80} height={30} />
            </div>
          ))}
        </div>
      )}
      {d && (
        <div className={s.cards}>
          <MasterCard
            to="/admin/masters/departments"
            title="Departments"
            helper="Where observations are recorded."
          >
            <Counts n={d.departments.active} noun="departments" inactive={d.departments.inactive} />
          </MasterCard>
          <MasterCard
            to="/admin/masters/wards"
            title="Wards"
            helper="The wards and units that are observed, with monthly targets."
          >
            <Counts n={d.wards.active} noun="wards" inactive={d.wards.inactive} />
            <p className={s.meta}>
              Monthly target total {fmt(d.wards.monthly_target_total)} opportunities
            </p>
          </MasterCard>
          <MasterCard
            to="/admin/masters/staff-categories"
            title="Staff categories"
            helper="Who is observed. Each has a code for the printable sheet."
          >
            <Counts
              n={d.staff_categories.active}
              noun="categories"
              inactive={d.staff_categories.inactive}
            />
          </MasterCard>
          <MasterCard
            to="/admin/masters/kpi"
            title="KPI thresholds"
            helper="When compliance counts as green, amber or red."
          >
            <p className={s.meta}>
              Green ≥ {d.kpi.green}% · Amber ≥ {d.kpi.amber}%
            </p>
            <p className={s.meta}>No entry alert after {d.kpi.inactive_days} days</p>
          </MasterCard>
          <MasterCard
            to="/admin/masters/import-export"
            title="Import & export"
            helper="Download the masters to Excel or CSV, or update them in bulk from a file."
          />
        </div>
      )}
    </div>
  );
}
