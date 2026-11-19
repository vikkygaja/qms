import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import {
  createMaster,
  exportUrl,
  listDepartments,
  listStaffCategories,
  listWards,
  setMasterStatus,
  updateMaster,
  type MasterListParams,
} from '../../api/masters';
import type {
  Department,
  ItemStatus,
  MasterKind,
  Page,
  StaffCategory,
  Ward,
} from '../../api/types';
import { Pagination } from '../../components/Pagination';

type Item = Department | Ward | StaffCategory;

const PAGE_SIZE = 50;

interface KindConfig {
  title: string;
  singular: string;
  columns: string[];
  fetch: (p: MasterListParams) => Promise<Page<Item>>;
}

const CONFIG: Record<MasterKind, KindConfig> = {
  wards: {
    title: 'Wards',
    singular: 'ward',
    columns: ['Ward', 'Department', 'HH target'],
    fetch: listWards,
  },
  departments: {
    title: 'Departments',
    singular: 'department',
    columns: ['Department', 'Wards'],
    fetch: listDepartments,
  },
  'staff-categories': {
    title: 'Staff categories (observed)',
    singular: 'category',
    columns: ['Category', 'Code'],
    fetch: listStaffCategories,
  },
};

interface Values {
  name: string;
  department_id: string;
  monthly_target: string;
  code: string;
}
const EMPTY: Values = { name: '', department_id: '', monthly_target: '40', code: '' };

function valuesOf(kind: MasterKind, item: Item): Values {
  const v = { ...EMPTY, name: item.name };
  if (kind === 'wards') {
    const w = item as Ward;
    v.department_id = w.department.id;
    v.monthly_target = String(w.monthly_target);
  }
  if (kind === 'staff-categories') v.code = (item as StaffCategory).code;
  return v;
}

/** Client-side checks; the server repeats them and stays the authority. */
function validate(kind: MasterKind, v: Values): Record<string, string> {
  const e: Record<string, string> = {};
  const name = v.name.trim();
  if (name.length < 1 || name.length > 100) e.name = 'Enter a name of 1 to 100 characters.';
  if (kind === 'wards') {
    if (!v.department_id) e.department_id = 'Choose a department.';
    const t = Number(v.monthly_target);
    if (v.monthly_target.trim() === '' || !Number.isInteger(t) || t < 0 || t > 100000)
      e.monthly_target = 'Enter a whole number from 0 to 100000.';
  }
  if (kind === 'staff-categories' && !/^[A-Za-z0-9]{1,3}$/.test(v.code.trim()))
    e.code = 'Enter 1 to 3 letters or digits.';
  return e;
}

function toBody(kind: MasterKind, v: Values): object {
  const name = v.name.trim();
  if (kind === 'wards')
    return { name, department_id: v.department_id, monthly_target: Number(v.monthly_target) };
  if (kind === 'staff-categories') return { name, code: v.code.trim() };
  return { name };
}

function MasterForm({
  kind,
  item,
  onDone,
  onCancel,
}: {
  kind: MasterKind;
  item?: Item;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const cfg = CONFIG[kind];
  const [v, setV] = useState<Values>(item ? valuesOf(kind, item) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const departments = useQuery({
    queryKey: ['masters', 'departments', 'active-options'],
    queryFn: () => listDepartments({ status: 'Active', page_size: 500 }),
    enabled: kind === 'wards',
  });
  const set = (k: keyof Values) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const id = (k: string) => `${kind}-${k}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError('');
    const found = validate(kind, v);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      if (item) await updateMaster(kind, item.id, toBody(kind, v));
      else await createMaster(kind, toBody(kind, v));
      onDone(item ? 'Saved.' : `Added ${v.name.trim()}.`);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields: Record<string, string> = {};
        for (const d of err.details) fields[d.field] = d.message;
        setErrors(fields);
        if (err.details.length === 0) setServerError(err.message);
      } else setServerError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const fieldErr = (k: string) =>
    errors[k] && (
      <span className="err" role="alert">
        {errors[k]}
      </span>
    );
  // department list: Active ones, plus the ward's current department even if now Inactive
  const options = [...(departments.data?.items ?? [])];
  if (item && kind === 'wards') {
    const cur = (item as Ward).department;
    if (!options.some((d) => d.id === cur.id))
      options.push({ ...cur, status: 'Inactive', ward_count: 0 });
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)} noValidate>
      <strong>{item ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`}</strong>
      <div className="formgrid">
        <label className="f" htmlFor={id('name')}>
          {cfg.title === 'Wards' ? 'Ward name' : `${cap(cfg.singular)} name`}
          <input
            id={id('name')}
            type="text"
            maxLength={100}
            value={v.name}
            onChange={set('name')}
            aria-invalid={!!errors.name}
          />
          {fieldErr('name')}
        </label>
        {kind === 'wards' && (
          <>
            <label className="f" htmlFor={id('dept')}>
              Department
              <select
                id={id('dept')}
                value={v.department_id}
                onChange={set('department_id')}
                aria-invalid={!!errors.department_id}
              >
                <option value="">Choose…</option>
                {options.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {fieldErr('department_id')}
            </label>
            <label className="f" htmlFor={id('target')}>
              HH target (per month)
              <input
                id={id('target')}
                type="number"
                min={0}
                max={100000}
                value={v.monthly_target}
                onChange={set('monthly_target')}
                aria-invalid={!!errors.monthly_target}
              />
              {fieldErr('monthly_target')}
            </label>
          </>
        )}
        {kind === 'staff-categories' && (
          <label className="f" htmlFor={id('code')}>
            Code (1 to 3 letters or digits)
            <input
              id={id('code')}
              type="text"
              maxLength={3}
              value={v.code}
              onChange={set('code')}
              aria-invalid={!!errors.code}
            />
            {fieldErr('code')}
          </label>
        )}
      </div>
      {serverError && (
        <p role="alert" className="err">
          {serverError}
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn sm" disabled={busy}>
          Save
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type FormState = { mode: 'add' } | { mode: 'edit'; item: Item } | null;

export function MasterList({
  kind,
  onChanged,
}: {
  kind: MasterKind;
  onChanged: (message: string) => void;
}) {
  const cfg = CONFIG[kind];
  const qc = useQueryClient();
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ItemStatus | ''>('Active');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState>(null);
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  const data = useQuery({
    queryKey: ['masters', kind, { q, status, page }],
    queryFn: () => cfg.fetch({ q, status, page, page_size: PAGE_SIZE }),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['masters'] });
  const items = data.data?.items ?? [];

  async function confirmStatus(e: FormEvent, item: Item) {
    e.preventDefault();
    if (!reason.trim()) return setReasonError('Enter a reason.');
    const next: ItemStatus = item.status === 'Active' ? 'Inactive' : 'Active';
    try {
      await setMasterStatus(kind, item.id, next, reason.trim());
      setStatusFor(null);
      setReason('');
      setReasonError('');
      onChanged(`${item.name} is now ${next}.`);
      refresh();
    } catch (err) {
      setReasonError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  const cells = (item: Item) => {
    if (kind === 'wards') {
      const w = item as Ward;
      return [w.department.name, <span key="t">{w.monthly_target}</span>];
    }
    if (kind === 'departments') return [(item as Department).ward_count];
    return [<code key="c">{(item as StaffCategory).code}</code>];
  };
  const colCount = cfg.columns.length + 2;

  return (
    <section className="card" aria-labelledby={`${kind}-h`}>
      <div className="row between">
        <h2 id={`${kind}-h`}>{cfg.title}</h2>
        <button
          type="button"
          className="btn ghost sm"
          aria-label={`Add ${cfg.singular}`}
          onClick={() => setForm({ mode: 'add' })}
        >
          + Add
        </button>
      </div>

      {form && (
        <MasterForm
          key={form.mode === 'edit' ? form.item.id : 'add'}
          kind={kind}
          item={form.mode === 'edit' ? form.item : undefined}
          onCancel={() => setForm(null)}
          onDone={(m) => {
            setForm(null);
            onChanged(m);
            refresh();
          }}
        />
      )}

      <form
        className="row"
        role="search"
        style={{ alignItems: 'end' }}
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draftQ.trim());
          setPage(1);
        }}
      >
        <label className="f" htmlFor={`${kind}-q`}>
          Search {cfg.title.toLowerCase()}
          <input
            id={`${kind}-q`}
            type="search"
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </label>
        <label className="f" htmlFor={`${kind}-status`}>
          Show {cfg.title.toLowerCase()}
          <select
            id={`${kind}-status`}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ItemStatus | '');
              setPage(1);
            }}
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="">All</option>
          </select>
        </label>
        <button
          type="submit"
          className="btn ghost sm"
          aria-label={`Run search in ${cfg.title.toLowerCase()}`}
        >
          Search
        </button>
      </form>

      <div className="row small">
        <a
          className="btn ghost sm"
          href={exportUrl(kind, 'xlsx')}
          aria-label={`Download ${cfg.title} as Excel`}
        >
          Download Excel
        </a>
        <a
          className="btn ghost sm"
          href={exportUrl(kind, 'csv')}
          aria-label={`Download ${cfg.title} as CSV`}
        >
          Download CSV
        </a>
      </div>

      {data.isError && (
        <p role="alert" className="err">
          {data.error instanceof ApiError ? data.error.message : 'Could not load the list.'}
        </p>
      )}

      <div className="tw">
        <table>
          <thead>
            <tr>
              {cfg.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const active = item.status === 'Active';
              return (
                <Fragment key={item.id}>
                  <tr>
                    <td>{item.name}</td>
                    {cells(item).map((c, i) => (
                      <td key={i}>{c}</td>
                    ))}
                    <td>
                      <span className={`pill ${active ? 'p-good' : 'p-bad'}`}>{item.status}</span>
                    </td>
                    <td>
                      <span className="row">
                        <button
                          type="button"
                          className="btn ghost sm"
                          aria-label={`Edit ${item.name}`}
                          onClick={() => setForm({ mode: 'edit', item })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`btn sm ${active ? 'danger' : ''}`}
                          aria-label={`${active ? 'Make inactive' : 'Make active'}: ${item.name}`}
                          onClick={() => {
                            setStatusFor(item.id);
                            setReason('');
                            setReasonError('');
                          }}
                        >
                          {active ? 'Make inactive' : 'Make active'}
                        </button>
                      </span>
                    </td>
                  </tr>
                  {statusFor === item.id && (
                    <tr>
                      <td colSpan={colCount}>
                        <form className="panel" onSubmit={(e) => void confirmStatus(e, item)}>
                          <div className="row" style={{ alignItems: 'end' }}>
                            <label className="f" htmlFor={`${kind}-reason`} style={{ flex: 1 }}>
                              Reason for {active ? 'making inactive' : 'making active'} (required)
                              <input
                                id={`${kind}-reason`}
                                type="text"
                                autoFocus
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                              />
                            </label>
                            <button type="submit" className="btn sm">
                              Confirm
                            </button>
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() => setStatusFor(null)}
                            >
                              Cancel
                            </button>
                          </div>
                          <p role="alert" className="err">
                            {reasonError}
                          </p>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.isSuccess && items.length === 0 && (
        <p className="muted small">No {cfg.title.toLowerCase()} found.</p>
      )}
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={data.data?.total ?? 0}
        onChange={setPage}
      />
    </section>
  );
}
