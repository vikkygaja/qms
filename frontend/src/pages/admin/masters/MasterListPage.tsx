import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../../api/client';
import { setMasterStatus, type MasterListParams } from '../../../api/masters';
import type { MasterKind, Page } from '../../../api/types';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { DataTable, type Column } from '../../../components/DataTable';
import { EmptyState } from '../../../components/EmptyState';
import { FilterBar } from '../../../components/FilterBar';
import { PageHeader } from '../../../components/PageHeader';
import { Pagination } from '../../../components/Pagination';
import { StatusPill } from '../../../components/StatusPill';
import { SkeletonRows } from '../../../components/Skeleton';
import { useToast } from '../../../lib/useToast';
import { MasterDrawer, type MasterItem } from './MasterDrawer';
import s from './masters.module.css';
import {
  PAGE_SIZES,
  statusParam,
  useListParams,
  type ListState,
  type StatusFilter,
} from './useListParams';

export interface MasterListConfig<T extends MasterItem> {
  kind: MasterKind;
  title: string;
  singular: string; // "ward"
  plural: string; // "wards"
  description: ReactNode;
  fetchList: (p: MasterListParams) => Promise<Page<T>>;
  /** Columns before the status and actions columns, in order. The first one is sticky. */
  columns: Column<T>[];
  sortKeys: { name: string; status: string };
  inactiveEffect: string;
  activeEffect: string;
  firstTimeText: string;
  /** URL keys of extra filters (for example department_id) and how they reach the API. */
  extraKeys?: string[];
  extraFilters?: (
    state: ListState,
    set: (patch: Record<string, string | undefined>) => void,
  ) => ReactNode;
  /** Content between the header and the table (summary strip). */
  above?: ReactNode;
}

const STATUS_LABEL: Record<StatusFilter, string> = {
  active: 'Active',
  inactive: 'Inactive',
  all: 'All',
};

export function MasterListPage<T extends MasterItem>({ cfg }: { cfg: MasterListConfig<T> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { state, update, toggleSort } = useListParams('name', cfg.extraKeys);
  const [draftQ, setDraftQ] = useState(state.q);
  const [drawer, setDrawer] = useState<{ item?: T } | null>(null);
  const [statusFor, setStatusFor] = useState<T | null>(null);

  // Debounced search; Enter-free. External URL changes (clear, back) flow into the box.
  useEffect(() => {
    const t = setTimeout(() => {
      if (draftQ.trim() !== state.q) update({ q: draftQ.trim() }, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [draftQ, state.q, update]);
  useEffect(() => {
    setDraftQ((d) => (d.trim() === state.q ? d : state.q));
  }, [state.q]);

  const params: MasterListParams = {
    q: state.q,
    status: statusParam(state.status),
    sort: state.sort,
    order: state.order,
    page: state.page,
    page_size: state.pageSize,
    ...(state.extra as { department_id?: string }),
  };
  const data = useQuery({
    queryKey: ['masters', cfg.kind, params],
    queryFn: () => cfg.fetchList(params),
    placeholderData: keepPreviousData,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['masters'] });
  const items = data.data?.items ?? [];
  const total = data.data?.total ?? 0;

  const filtersActive =
    state.q !== '' || state.status !== 'active' || Object.keys(state.extra).length > 0;
  const clearFilters = () => {
    setDraftQ('');
    update({
      q: undefined,
      status: undefined,
      ...Object.fromEntries(Object.keys(state.extra).map((k) => [k, undefined])),
    });
  };

  const columns: Column<T>[] = [
    ...cfg.columns.map((c, i) => ({ ...c, sticky: i === 0 })),
    {
      key: 'status',
      header: 'Status',
      sortKey: cfg.sortKeys.status,
      render: (r) => <StatusPill status={r.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => {
        const active = r.status === 'Active';
        return (
          <span className={s.rowActions}>
            <button
              type="button"
              className="btn ghost sm"
              aria-label={`Edit ${r.name}`}
              onClick={() => setDrawer({ item: r })}
            >
              Edit
            </button>
            <button
              type="button"
              className={`btn sm ${active ? 'danger' : 'ghost'}`}
              aria-label={`${active ? 'Make inactive' : 'Make active'}: ${r.name}`}
              onClick={() => setStatusFor(r)}
            >
              {active ? 'Make inactive' : 'Make active'}
            </button>
          </span>
        );
      },
    },
  ];

  const from = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const to = Math.min(total, state.page * state.pageSize);
  const firstTime = data.isSuccess && total === 0 && !filtersActive;

  const addButton = (
    <button type="button" className="btn" onClick={() => setDrawer({})}>
      <span aria-hidden="true">+ </span>Add {cfg.singular}
    </button>
  );

  async function changeStatus(reason: string) {
    if (!statusFor) return;
    const next = statusFor.status === 'Active' ? 'Inactive' : 'Active';
    await setMasterStatus(cfg.kind, statusFor.id, next, reason);
    toast.show(`${statusFor.name} is now ${next}.`);
    setStatusFor(null);
    refresh();
  }

  return (
    <div className={s.page}>
      <PageHeader
        crumbs={[{ label: 'Masters', to: '/admin/masters' }, { label: cfg.title }]}
        title={cfg.title}
        count={
          data.isSuccess
            ? `${total.toLocaleString('en-IN')} ${total === 1 ? cfg.singular : cfg.plural}`
            : undefined
        }
        description={cfg.description}
        actions={addButton}
      />
      {cfg.above}
      <section className={s.panel} aria-label={`${cfg.title} list`}>
        <FilterBar label={`Filter ${cfg.plural}`}>
          <label className={`f ${s.grow}`} htmlFor="f-q">
            Search {cfg.plural}
            <input
              id="f-q"
              type="search"
              placeholder="Type a name"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
            />
          </label>
          {cfg.extraFilters?.(state, update)}
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

        {data.isPending && <SkeletonRows rows={8} label={`Loading ${cfg.plural}`} />}
        {data.isError && (
          <div className={s.err}>
            <p role="alert" className="err">
              {data.error instanceof ApiError
                ? data.error.message
                : `Could not load ${cfg.plural}.`}
            </p>
            <button type="button" className="btn ghost sm" onClick={() => void data.refetch()}>
              Try again
            </button>
          </div>
        )}
        {firstTime && (
          <EmptyState title={`No ${cfg.plural} yet`} description={cfg.firstTimeText}>
            <button type="button" className="btn" onClick={() => setDrawer({})}>
              Add the first {cfg.singular}
            </button>
            <Link className="btn ghost" to="/admin/masters/import-export">
              Import from Excel
            </Link>
          </EmptyState>
        )}
        {data.isSuccess && total === 0 && filtersActive && (
          <EmptyState
            title={`No ${cfg.plural} match these filters`}
            description="Try a different search, or show inactive items too."
          >
            <button type="button" className="btn ghost" onClick={clearFilters}>
              Clear filters
            </button>
          </EmptyState>
        )}
        {items.length > 0 && (
          <>
            <DataTable
              caption={cfg.title}
              columns={columns}
              rows={items}
              rowKey={(r) => r.id}
              sort={state.sort}
              order={state.order}
              onSort={toggleSort}
            />
            <div className={s.foot}>
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

      {drawer && (
        <MasterDrawer
          key={drawer.item?.id ?? 'new'}
          kind={cfg.kind}
          item={drawer.item}
          onClose={() => setDrawer(null)}
          onSaved={(m) => {
            setDrawer(null);
            toast.show(m);
            refresh();
          }}
        />
      )}
      {statusFor && (
        <ConfirmDialog
          title={
            statusFor.status === 'Active'
              ? `Make ${statusFor.name} inactive?`
              : `Make ${statusFor.name} active?`
          }
          description={
            <p>{statusFor.status === 'Active' ? cfg.inactiveEffect : cfg.activeEffect}</p>
          }
          reasonLabel="Reason (required)"
          confirmLabel={statusFor.status === 'Active' ? 'Make inactive' : 'Make active'}
          danger={statusFor.status === 'Active'}
          onConfirm={changeStatus}
          onCancel={() => setStatusFor(null)}
        />
      )}
      {toast.node}
    </div>
  );
}
