import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import type { Permission, Role } from '../../api/types';
import { createRole, listPermissions, listRoles, setRolePermissions } from '../../api/users';
import { useToast } from '../../lib/useToast';

const messageOf = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Something went wrong. Try again.';

export function RolesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const perms = useQuery({ queryKey: ['permissions'], queryFn: listPermissions });
  const roles = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const [name, setName] = useState('');
  const [roleError, setRoleError] = useState('');
  const [matrixError, setMatrixError] = useState('');

  async function toggle(role: Role, perm: Permission, checked: boolean) {
    setMatrixError('');
    const order = (perms.data ?? []).map((p) => p.code);
    const set = new Set(role.permissions);
    if (checked) set.add(perm.code);
    else set.delete(perm.code);
    const next = order.filter((c) => set.has(c));
    try {
      await setRolePermissions(role.id, next);
      await qc.invalidateQueries({ queryKey: ['roles'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
      toast.show(`Saved: ${role.name} · ${perm.description}.`);
    } catch (e) {
      setMatrixError(messageOf(e));
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setRoleError('Enter a role name.');
    try {
      await createRole(n);
      setName('');
      setRoleError('');
      await qc.invalidateQueries({ queryKey: ['roles'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
      toast.show(`Role "${n}" added. Tick its permissions, then assign it to users.`);
    } catch (err) {
      setRoleError(messageOf(err));
    }
  }

  const roleList = roles.data ?? [];
  return (
    <section className="card">
      <div>
        <h1>Roles &amp; permissions</h1>
        <p className="small muted">
          Tick what each role can do. Changes apply immediately to everyone in that role. Future
          modules (CAPA, MRD…) add their own rows here.
        </p>
      </div>
      {(perms.isError || roles.isError) && (
        <p role="alert" className="err">
          {messageOf(perms.error ?? roles.error)}
        </p>
      )}
      <p role="alert" className="err">
        {matrixError}
      </p>
      <div className="tw">
        <table className="matrix">
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {roleList.map((r) => (
                <th key={r.id} scope="col" className="c">
                  {r.name}
                  <br />
                  <span className="small muted">{r.active_user_count} users</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(perms.data ?? []).map((p) => (
              <tr key={p.code}>
                <th scope="row" style={{ fontSize: 'inherit', color: 'inherit', fontWeight: 400 }}>
                  {p.description}
                </th>
                {roleList.map((r) => {
                  const locked = r.key === 'admin' && p.code === 'users';
                  return (
                    <td key={r.id} className="c">
                      <input
                        type="checkbox"
                        checked={r.permissions.includes(p.code)}
                        disabled={locked}
                        title={locked ? 'Admin always keeps this' : undefined}
                        aria-label={`${r.name}: ${p.description}`}
                        onChange={(e) => void toggle(r, p, e.target.checked)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="row" style={{ alignItems: 'end' }} onSubmit={(e) => void add(e)} noValidate>
        <label className="f" htmlFor="new-role">
          New role name
          <input
            id="new-role"
            type="text"
            value={name}
            placeholder="e.g. Nursing Superintendent"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button type="submit" className="btn ghost">
          + Add role
        </button>
        <p role="alert" className="err">
          {roleError}
        </p>
      </form>
      <p className="small muted">
        Example: give &quot;Manage link nurses&quot; to a Nursing Superintendent role, and anyone
        with that role sees the Link nurses page.
      </p>
      {toast.node}
    </section>
  );
}
