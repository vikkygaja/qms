import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { listAudit } from '../../api/users';
import { AuditTable } from '../../components/AuditTable';
import { Pagination } from '../../components/Pagination';

const PAGE_SIZE = 25;
const ACTIONS = [
  'create',
  'update',
  'status_change',
  'password_reset',
  'password_change',
  'permission_change',
  'role_create',
  'account_locked',
];
const ENTITIES = ['user', 'role'];

interface Filters {
  entity: string;
  action: string;
  date_from: string;
  date_to: string;
  q: string;
}
const EMPTY: Filters = { entity: '', action: '', date_from: '', date_to: '', q: '' };

export function AuditLogPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);

  const audit = useQuery({
    queryKey: ['audit', 'list', filters, page],
    queryFn: () => listAudit({ ...filters, page, page_size: PAGE_SIZE }),
  });
  const set = (k: keyof Filters) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <section className="card">
      <div>
        <h1>Audit log</h1>
        <p className="small muted">Every change to users, roles and permissions. Newest first.</p>
      </div>
      <form
        className="row"
        role="search"
        style={{ alignItems: 'end' }}
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...draft, q: draft.q.trim() });
          setPage(1);
        }}
      >
        <label className="f" htmlFor="a-entity">
          Entity
          <select id="a-entity" value={draft.entity} onChange={set('entity')}>
            <option value="">All</option>
            {ENTITIES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="f" htmlFor="a-action">
          Action
          <select id="a-action" value={draft.action} onChange={set('action')}>
            <option value="">All</option>
            {ACTIONS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="f" htmlFor="a-from">
          From date
          <input id="a-from" type="date" value={draft.date_from} onChange={set('date_from')} />
        </label>
        <label className="f" htmlFor="a-to">
          To date
          <input id="a-to" type="date" value={draft.date_to} onChange={set('date_to')} />
        </label>
        <label className="f" htmlFor="a-q">
          Search text
          <input id="a-q" type="search" value={draft.q} onChange={set('q')} />
        </label>
        <button type="submit" className="btn ghost">
          Apply filters
        </button>
      </form>
      {audit.isError && (
        <p role="alert" className="err">
          {audit.error instanceof ApiError ? audit.error.message : 'Could not load the audit log.'}
        </p>
      )}
      <AuditTable items={audit.data?.items ?? []} />
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={audit.data?.total ?? 0}
        onChange={setPage}
      />
    </section>
  );
}
