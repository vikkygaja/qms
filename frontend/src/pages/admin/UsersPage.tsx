import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import type { User } from '../../api/types';
import {
  createUser,
  listAudit,
  listRoles,
  listUsers,
  resetPassword,
  setUserStatus,
  updateUser,
} from '../../api/users';
import { useAuth } from '../../auth/AuthProvider';
import { LINK_NURSE_ROLE } from '../../app/nav';
import { AuditTable } from '../../components/AuditTable';
import { Pagination } from '../../components/Pagination';
import { useToast } from '../../lib/useToast';
import { toNewUser, UserForm, type UserFormValues } from './UserForm';

const PAGE_SIZE = 25;

interface Secret {
  name: string;
  employeeId: string;
  password: string;
}

type FormState = { mode: 'add' } | { mode: 'edit'; user: User } | null;

export function UsersPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const [draftQ, setDraftQ] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [actionError, setActionError] = useState('');
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  const users = useQuery({
    queryKey: ['users', { q, status, page }],
    queryFn: () => listUsers({ q, status, page, page_size: PAGE_SIZE }),
  });
  const roles = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const recent = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => listAudit({ page_size: 5 }),
  });

  const assignable = (roles.data ?? []).filter((r) => r.key !== LINK_NURSE_ROLE);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: ['audit'] });
    void qc.invalidateQueries({ queryKey: ['roles'] });
  };
  const messageOf = (e: unknown) =>
    e instanceof ApiError ? e.message : 'Something went wrong. Try again.';

  async function save(values: UserFormValues) {
    if (form?.mode === 'edit') {
      await updateUser(form.user.id, {
        full_name: values.full_name,
        designation: values.designation,
        role_id: values.role_id,
        mobile: values.mobile,
        email: values.email,
      });
      toast.show('Saved.');
    } else {
      const res = await createUser(toNewUser(values));
      setSecret({
        name: res.user.full_name,
        employeeId: res.user.employee_id,
        password: res.temporary_password,
      });
    }
    setForm(null);
    refresh();
  }

  async function reset(u: User) {
    setActionError('');
    try {
      const res = await resetPassword(u.id);
      setSecret({
        name: res.user.full_name,
        employeeId: res.user.employee_id,
        password: res.temporary_password,
      });
      refresh();
    } catch (e) {
      setActionError(messageOf(e));
    }
  }

  async function confirmStatus(e: FormEvent, u: User) {
    e.preventDefault();
    if (!reason.trim()) return setReasonError('Enter a reason.');
    const next = u.status === 'Active' ? 'Inactive' : 'Active';
    try {
      await setUserStatus(u.id, next, reason.trim());
      setStatusFor(null);
      setReason('');
      setReasonError('');
      toast.show(`${u.full_name} is now ${next}.`);
      refresh();
    } catch (err) {
      setReasonError(messageOf(err));
    }
  }

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(
        `Username: ${secret.employeeId}  Temporary password: ${secret.password}`,
      );
      toast.show('Copied.');
    } catch {
      toast.show('Copy not allowed here; note it down.');
    }
  }

  const rows = users.data?.items ?? [];
  return (
    <>
      <section className="card">
        <div className="row between">
          <div>
            <h1>Users</h1>
            <p className="small muted">
              Admin creates platform users (ICN, Quality Manager, Admin, custom roles). Link nurses
              are created by the ICN. No delete; use Active/Inactive.
            </p>
          </div>
          <button
            type="button"
            className="btn"
            disabled={!roles.data}
            onClick={() => {
              setSecret(null);
              setForm({ mode: 'add' });
            }}
          >
            + Add user
          </button>
        </div>

        {secret && (
          <div className="secret" role="group" aria-label="Temporary password">
            <strong>Login created for {secret.name}</strong>
            <span>
              Username: <code>{secret.employeeId}</code> · Temporary password:{' '}
              <code>{secret.password}</code>
            </span>
            <span className="small">
              Shown once. The user must set a new password at first login.
            </span>
            <div className="row">
              <button type="button" className="btn sm" onClick={() => void copy()}>
                Copy
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setSecret(null)}>
                Done
              </button>
            </div>
          </div>
        )}

        {form && (
          <UserForm
            key={form.mode === 'edit' ? form.user.id : 'add'}
            mode={form.mode}
            user={form.mode === 'edit' ? form.user : undefined}
            roles={assignable}
            onSubmit={save}
            onCancel={() => setForm(null)}
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
          <label className="f" htmlFor="u-search">
            Search name or employee ID
            <input
              id="u-search"
              type="search"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
            />
          </label>
          <label className="f" htmlFor="u-status">
            Status
            <select
              id="u-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>
          <button type="submit" className="btn ghost">
            Search
          </button>
        </form>

        <p role="alert" className="err">
          {actionError}
        </p>
        {users.isError && (
          <p role="alert" className="err">
            {messageOf(users.error)}
          </p>
        )}

        <div className="tw">
          <table>
            <thead>
              <tr>
                <th scope="col">Employee ID</th>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const managed = u.role.key === LINK_NURSE_ROLE;
                const active = u.status === 'Active';
                return (
                  <Fragment key={u.id}>
                    <tr>
                      <td>
                        <code>{u.employee_id}</code>
                      </td>
                      <td>
                        <strong>{u.full_name}</strong>
                        <br />
                        <span className="small muted">{u.designation}</span>
                      </td>
                      <td>{u.role.name}</td>
                      <td>
                        <span className={`pill ${active ? 'p-good' : 'p-bad'}`}>{u.status}</span>
                        {u.must_change_password && (
                          <>
                            {' '}
                            <span className="pill p-n">First login pending</span>
                          </>
                        )}
                      </td>
                      <td>
                        {managed ? (
                          <span className="row">
                            <span className="small muted">Managed by ICN (Link nurses page)</span>
                            {can('ln') && (
                              <Link
                                className="small"
                                to={`/hand-hygiene/link-nurses?q=${encodeURIComponent(u.employee_id)}&status=all`}
                                aria-label={`Open ${u.full_name} on the Link nurses page`}
                              >
                                Open Link nurses
                              </Link>
                            )}
                          </span>
                        ) : (
                          <span className="row">
                            <button
                              type="button"
                              className="btn ghost sm"
                              aria-label={`Edit ${u.full_name}`}
                              onClick={() => {
                                setSecret(null);
                                setForm({ mode: 'edit', user: u });
                              }}
                            >
                              Edit
                            </button>
                            {active && (
                              <button
                                type="button"
                                className="btn ghost sm"
                                aria-label={`Reset password for ${u.full_name}`}
                                onClick={() => void reset(u)}
                              >
                                Reset password
                              </button>
                            )}
                            <button
                              type="button"
                              className={`btn sm ${active ? 'danger' : ''}`}
                              aria-label={`${active ? 'Make inactive' : 'Make active'}: ${u.full_name}`}
                              onClick={() => {
                                setStatusFor(u.id);
                                setReason('');
                                setReasonError('');
                              }}
                            >
                              {active ? 'Make inactive' : 'Make active'}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                    {statusFor === u.id && (
                      <tr>
                        <td colSpan={5}>
                          <form className="panel" onSubmit={(e) => void confirmStatus(e, u)}>
                            <div className="row" style={{ alignItems: 'end' }}>
                              <label className="f" htmlFor="u-reason" style={{ flex: 1 }}>
                                Reason (required)
                                <input
                                  id="u-reason"
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
        {users.isSuccess && rows.length === 0 && <p className="muted small">No users found.</p>}
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={users.data?.total ?? 0}
          onChange={setPage}
        />
      </section>

      <section className="card">
        <h2>Audit log</h2>
        <AuditTable items={recent.data?.items ?? []} />
      </section>
      {toast.node}
    </>
  );
}
