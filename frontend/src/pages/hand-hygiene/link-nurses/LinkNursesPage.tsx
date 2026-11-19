import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/client';
import {
  listLinkNurses,
  listRecentLinkNurseChanges,
  resetLinkNursePassword,
  setLinkNurseStatus,
  type LinkNurseListParams,
} from '../../../api/linkNurses';
import { getKpiSettings, listWards } from '../../../api/masters';
import type { LinkNurse } from '../../../api/types';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { DataTable, type Column } from '../../../components/DataTable';
import { EmptyState } from '../../../components/EmptyState';
import { FilterBar } from '../../../components/FilterBar';
import { PageHeader } from '../../../components/PageHeader';
import { Pagination } from '../../../components/Pagination';
import { SkeletonRows } from '../../../components/Skeleton';
import { StatusPill } from '../../../components/StatusPill';
import { formatDay, formatWhen, todayIso } from '../../../lib/format';
import { useToast } from '../../../lib/useToast';
import {
  PAGE_SIZES,
  statusParam,
  useListParams,
  type StatusFilter,
} from '../../admin/masters/useListParams';
import m from '../../admin/masters/masters.module.css';
import { LinkNurseDrawer } from './LinkNurseDrawer';
import s from './linkNurses.module.css';
import { SecretBox, type Secret } from './SecretBox';
import { WardsDrawer } from './WardsDrawer';

const STATUS_LABEL: Record<StatusFilter, string> = {
  active: 'Active',
  inactive: 'Inactive',
  all: 'All',
};
const MAX_CHIPS = 3;

type Drawer = { kind: 'add' } | { kind: 'edit' | 'wards' | 'history'; nurse: LinkNurse } | null;
type Dialog = { kind: 'status' | 'reset'; nurse: LinkNurse } | null;

function WardChips({ wards }: { wards: LinkNurse['wards'] }) {
  if (wards.length === 0) return <span className={s.none}>None</span>;
  const extra = wards.length - MAX_CHIPS;
  return (
    <span className={s.chips}>
      {wards.slice(0, MAX_CHIPS).map((w) => (
        <span key={w.id} className={s.chip}>
          {w.name}
        </span>
      ))}
      {extra > 0 && (
        <span
          className={`${s.chip} ${s.chipMore}`}
          title={wards
            .slice(MAX_CHIPS)
            .map((w) => w.name)
            .join(', ')}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

function RecentChanges() {
  const q = useQuery({
    queryKey: ['link-nurses', 'recent'],
    queryFn: () => listRecentLinkNurseChanges(8),
  });
  return (
    <section className={m.panel} aria-label="Recent changes">
      <h2>Recent changes</h2>
      {q.isPending && <SkeletonRows rows={3} label="Loading recent changes" />}
      {q.isError && (
        <div className={m.err}>
          <p role="alert" className="err">
            {q.error instanceof ApiError ? q.error.message : 'Could not load recent changes.'}
          </p>
          <button type="button" className="btn ghost sm" onClick={() => void q.refetch()}>
            Try again
          </button>
        </div>
      )}
      {q.isSuccess && q.data.length === 0 && (
        <p className="small muted">No changes recorded yet.</p>
      )}
      {q.isSuccess && q.data.length > 0 && (
        <div className="tw">
          <table className={s.recent}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">By</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((a) => (
                <tr key={a.id}>
                  <td>{formatWhen(a.at)}</td>
                  <td>{a.actor?.full_name ?? 'System'}</td>
                  <td>{a.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function LinkNursesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { state, update, toggleSort } = useListParams('name', ['ward_id']);
  const [draftQ, setDraftQ] = useState(state.q);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [secret, setSecret] = useState<Secret | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (draftQ.trim() !== state.q) update({ q: draftQ.trim() }, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [draftQ, state.q, update]);
  useEffect(() => {
    setDraftQ((d) => (d.trim() === state.q ? d : state.q));
  }, [state.q]);

  const wardId = state.extra.ward_id;
  const params: LinkNurseListParams = {
    q: state.q,
    ward_id: wardId,
    status: statusParam(state.status),
    sort: state.sort,
    order: state.order,
    page: state.page,
    page_size: state.pageSize,
  };
  const data = useQuery({
    queryKey: ['link-nurses', 'list', params],
    queryFn: () => listLinkNurses(params),
    placeholderData: keepPreviousData,
  });
  const wardsQ = useQuery({
    queryKey: ['masters', 'wards', 'active-options'],
    queryFn: () => listWards({ status: 'Active', page_size: 500 }),
  });
  const kpi = useQuery({ queryKey: ['settings', 'kpi'], queryFn: getKpiSettings });
  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['link-nurses'] });
    void qc.invalidateQueries({ queryKey: ['masters'] });
    void qc.invalidateQueries({ queryKey: ['audit'] });
  };

  const filtersActive = state.q !== '' || state.status !== 'active' || wardId !== undefined;
  const clearFilters = () => {
    setDraftQ('');
    update({ q: undefined, status: undefined, ward_id: undefined });
  };
  const firstTime = data.isSuccess && total === 0 && !filtersActive;
  const from = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const to = Math.min(total, state.page * state.pageSize);
  const noEntryText = kpi.data ? `No entry ${kpi.data.inactive_days}+ days` : 'No recent entry';

  const columns: Column<LinkNurse>[] = [
    {
      key: 'emp',
      header: 'Employee ID',
      sortKey: 'employee_id',
      sticky: true,
      render: (n) => <span className={s.mono}>{n.employee_id}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      sortKey: 'name',
      render: (n) => (
        <>
          <strong>{n.full_name}</strong>
          <span className={s.sub}>
            {n.designation} - {n.department.name}
          </span>
        </>
      ),
    },
    { key: 'wards', header: 'Current ward(s)', render: (n) => <WardChips wards={n.wards} /> },
    {
      key: 'sessions',
      header: 'Sessions (month)',
      align: 'right',
      render: (n) => n.sessions_this_month.toLocaleString('en-IN'),
    },
    {
      key: 'last',
      header: 'Last entry',
      render: (n) => (
        <span className={s.pills}>
          {formatDay(n.last_entry_date)}
          {n.no_entry_flag && <span className="pill p-warn">{noEntryText}</span>}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (n) => (
        <span className={s.pills}>
          <StatusPill status={n.status} />
          {n.must_change_password && <span className="pill p-n">First login pending</span>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (n) => {
        const active = n.status === 'Active';
        const btn = (label: string, onClick: () => void, cls = 'ghost') => (
          <button
            type="button"
            className={`btn sm ${cls}`}
            aria-label={`${label}: ${n.full_name}`}
            onClick={onClick}
          >
            {label}
          </button>
        );
        return (
          <span className={s.actions}>
            {btn('Edit', () => setDrawer({ kind: 'edit', nurse: n }))}
            {active && btn('Wards', () => setDrawer({ kind: 'wards', nurse: n }))}
            {btn('History', () => setDrawer({ kind: 'history', nurse: n }))}
            {active && btn('Reset password', () => setDialog({ kind: 'reset', nurse: n }))}
            {btn(
              active ? 'Make inactive' : 'Make active',
              () => setDialog({ kind: 'status', nurse: n }),
              active ? 'danger' : 'ghost',
            )}
          </span>
        );
      },
    },
  ];

  async function changeStatus(n: LinkNurse, reason: string, date?: string) {
    const next = n.status === 'Active' ? 'Inactive' : 'Active';
    await setLinkNurseStatus(n.id, next, reason, date);
    toast.show(
      next === 'Active'
        ? `${n.full_name} is now Active. Assign wards to resume entries.`
        : `${n.full_name} is now Inactive.`,
    );
    setDialog(null);
    refresh();
  }

  async function resetPassword(n: LinkNurse) {
    const res = await resetLinkNursePassword(n.id);
    setSecret({
      name: res.link_nurse.full_name,
      employeeId: res.link_nurse.employee_id,
      password: res.temporary_password,
      kind: 'reset',
    });
    setDialog(null);
    refresh();
  }

  const addButton = (
    <button
      type="button"
      className="btn"
      onClick={() => {
        setSecret(null);
        setDrawer({ kind: 'add' });
      }}
    >
      <span aria-hidden="true">+ </span>Add link nurse
    </button>
  );
  const statusNurse = dialog?.kind === 'status' ? dialog.nurse : null;

  return (
    <div className={m.page}>
      <PageHeader
        crumbs={[{ label: 'Hand Hygiene' }, { label: 'Link nurses' }]}
        title="Link nurses"
        count={
          data.isSuccess
            ? `${total.toLocaleString('en-IN')} ${total === 1 ? 'link nurse' : 'link nurses'}`
            : undefined
        }
        description="Creating a link nurse also creates their login. Nothing is ever deleted; use Active or Inactive."
        actions={addButton}
      />
      {secret && <SecretBox secret={secret} onDone={() => setSecret(null)} />}
      <section className={m.panel} aria-label="Link nurses list">
        <FilterBar label="Filter link nurses">
          <label className={`f ${m.grow}`} htmlFor="f-q">
            Search link nurses
            <input
              id="f-q"
              type="search"
              placeholder="Name or employee ID"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
            />
          </label>
          <label className="f" htmlFor="f-ward">
            Ward
            <select
              id="f-ward"
              value={wardId ?? ''}
              onChange={(e) => update({ ward_id: e.target.value || undefined })}
            >
              <option value="">All wards</option>
              {(wardsQ.data?.items ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="f" htmlFor="f-status">
            Status
            <select
              id="f-status"
              value={state.status}
              onChange={(e) =>
                update({ status: e.target.value === 'active' ? undefined : e.target.value })
              }
            >
              {(['active', 'inactive', 'all'] as StatusFilter[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="f" htmlFor="f-size">
            Rows per page
            <select
              id="f-size"
              value={state.pageSize}
              onChange={(e) => update({ page_size: e.target.value })}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {filtersActive && (
            <button type="button" className="btn ghost sm" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </FilterBar>

        {data.isPending && <SkeletonRows rows={8} label="Loading link nurses" />}
        {data.isError && (
          <div className={m.err}>
            <p role="alert" className="err">
              {data.error instanceof ApiError ? data.error.message : 'Could not load link nurses.'}
            </p>
            <button type="button" className="btn ghost sm" onClick={() => void data.refetch()}>
              Try again
            </button>
          </div>
        )}
        {firstTime && (
          <EmptyState
            title="No link nurses yet"
            description="Add the first link nurse. Their login is created at the same time."
          >
            <button type="button" className="btn" onClick={() => setDrawer({ kind: 'add' })}>
              + Add link nurse
            </button>
          </EmptyState>
        )}
        {data.isSuccess && total === 0 && filtersActive && (
          <EmptyState
            title="No link nurses match these filters"
            description="Try a different search, another ward, or show inactive link nurses too."
          >
            <button type="button" className="btn ghost" onClick={clearFilters}>
              Clear filters
            </button>
          </EmptyState>
        )}
        {items.length > 0 && (
          <>
            <DataTable
              caption="Link nurses"
              columns={columns}
              rows={items}
              rowKey={(n) => n.id}
              sort={state.sort}
              order={state.order}
              onSort={toggleSort}
            />
            <div className={m.foot}>
              <Pagination
                page={state.page}
                pageSize={state.pageSize}
                total={total}
                onChange={(p) => update({ page: p > 1 ? String(p) : undefined })}
                label={`Showing ${from}-${to} of ${total.toLocaleString('en-IN')}`}
              />
            </div>
          </>
        )}
      </section>

      <RecentChanges />

      {drawer && (drawer.kind === 'add' || drawer.kind === 'edit') && (
        <LinkNurseDrawer
          key={drawer.kind === 'edit' ? drawer.nurse.id : 'new'}
          nurse={drawer.kind === 'edit' ? drawer.nurse : undefined}
          onClose={() => setDrawer(null)}
          onSaved={(msg) => {
            setDrawer(null);
            toast.show(msg);
            refresh();
          }}
          onCreated={(res) => {
            setDrawer(null);
            setSecret({
              name: res.link_nurse.full_name,
              employeeId: res.link_nurse.employee_id,
              password: res.temporary_password,
              kind: 'created',
            });
            toast.show(`Added ${res.link_nurse.full_name}.`);
            refresh();
          }}
        />
      )}
      {drawer && (drawer.kind === 'wards' || drawer.kind === 'history') && (
        <WardsDrawer
          key={`${drawer.kind}-${drawer.nurse.id}`}
          nurse={drawer.nurse}
          readOnly={drawer.kind === 'history'}
          onClose={() => setDrawer(null)}
          onSaved={(msg) => {
            setDrawer(null);
            toast.show(msg);
            refresh();
          }}
        />
      )}
      {statusNurse && (
        <ConfirmDialog
          title={
            statusNurse.status === 'Active'
              ? `Make ${statusNurse.full_name} inactive?`
              : `Make ${statusNurse.full_name} active?`
          }
          description={
            statusNurse.status === 'Active' ? (
              <p>
                Making a link nurse inactive blocks their login and ends all their ward assignments
                on the effective date. Past observations stay in reports.
              </p>
            ) : (
              <p>
                Making a link nurse active does not restore their wards. Assign wards afterwards to
                resume entries.
              </p>
            )
          }
          reasonLabel="Reason (required)"
          dateField={{ label: 'Effective date', max: todayIso(), defaultValue: todayIso() }}
          confirmLabel={statusNurse.status === 'Active' ? 'Make inactive' : 'Make active'}
          danger={statusNurse.status === 'Active'}
          onConfirm={(reason, date) => changeStatus(statusNurse, reason, date)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'reset' && (
        <ConfirmDialog
          title={`Reset password for ${dialog.nurse.full_name}?`}
          description={
            <p>
              This ends all their sessions and sets a new temporary password. They must choose a new
              password at next login.
            </p>
          }
          confirmLabel="Reset password"
          onConfirm={() => resetPassword(dialog.nurse)}
          onCancel={() => setDialog(null)}
        />
      )}
      {toast.node}
    </div>
  );
}
