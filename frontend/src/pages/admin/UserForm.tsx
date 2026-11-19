import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import type { Role, User } from '../../api/types';
import type { NewUser } from '../../api/users';

export interface UserFormValues {
  employee_id: string;
  full_name: string;
  designation: string;
  role_id: string;
  mobile: string;
  email: string;
}

const EMP_RE = /^[A-Za-z0-9_-]{3,20}$/;

/** Mirrors the server rules so most mistakes are caught before the request. */
export function validateUser(v: UserFormValues, mode: 'add' | 'edit'): Record<string, string> {
  const e: Record<string, string> = {};
  if (mode === 'add') {
    if (!v.employee_id) e.employee_id = 'Enter the employee ID.';
    else if (!EMP_RE.test(v.employee_id)) {
      e.employee_id = 'Employee ID must be 3 to 20 characters: letters, numbers, - or _.';
    }
  }
  if (!v.full_name) e.full_name = 'Enter the full name.';
  if (!v.designation) e.designation = 'Enter the designation.';
  if (!v.role_id) e.role_id = 'Choose a role.';
  if (!/^\d{10}$/.test(v.mobile)) e.mobile = 'Enter a 10-digit mobile number.';
  return e;
}

export function toNewUser(v: UserFormValues): NewUser {
  const u: NewUser = {
    employee_id: v.employee_id,
    full_name: v.full_name,
    designation: v.designation,
    role_id: v.role_id,
    mobile: v.mobile,
  };
  if (v.email) u.email = v.email;
  return u;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return (
    <span id={id} role="alert" className="err">
      {message}
    </span>
  );
}

export function UserForm({
  mode,
  user,
  roles,
  onSubmit,
  onCancel,
}: {
  mode: 'add' | 'edit';
  user?: User;
  roles: Role[];
  onSubmit: (values: UserFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [v, setV] = useState<UserFormValues>({
    employee_id: user?.employee_id ?? '',
    full_name: user?.full_name ?? '',
    designation: user?.designation ?? '',
    role_id: user?.role.id ?? roles[0]?.id ?? '',
    mobile: user?.mobile ?? '',
    email: user?.email ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof UserFormValues) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean: UserFormValues = {
      ...v,
      employee_id: v.employee_id.trim(),
      full_name: v.full_name.trim(),
      designation: v.designation.trim(),
      mobile: v.mobile.trim(),
      email: v.email.trim(),
    };
    const found = validateUser(clean, mode);
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await onSubmit(clean);
    } catch (err) {
      if (err instanceof ApiError) {
        const byField: Record<string, string> = {};
        for (const d of err.details) byField[d.field] = d.message;
        setErrors(byField);
        setFormError(err.details.length ? '' : err.message);
      } else {
        setFormError('Could not save. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  const bad = (k: string) => (errors[k] ? true : undefined);
  return (
    <form
      className="panel"
      onSubmit={submit}
      noValidate
      aria-label={mode === 'add' ? 'Add user' : 'Edit user'}
    >
      <h2>{mode === 'add' ? 'Add user' : 'Edit user'}</h2>
      <div className="formgrid">
        <label className="f" htmlFor="uf_emp">
          Employee ID (username) *
          <input
            id="uf_emp"
            type="text"
            value={v.employee_id}
            readOnly={mode === 'edit'}
            onChange={set('employee_id')}
            aria-invalid={bad('employee_id')}
            aria-describedby="uf_emp_e"
          />
          <FieldError id="uf_emp_e" message={errors.employee_id} />
        </label>
        <label className="f" htmlFor="uf_name">
          Full name *
          <input
            id="uf_name"
            type="text"
            value={v.full_name}
            onChange={set('full_name')}
            aria-invalid={bad('full_name')}
            aria-describedby="uf_name_e"
          />
          <FieldError id="uf_name_e" message={errors.full_name} />
        </label>
        <label className="f" htmlFor="uf_designation">
          Designation *
          <input
            id="uf_designation"
            type="text"
            value={v.designation}
            onChange={set('designation')}
            aria-invalid={bad('designation')}
            aria-describedby="uf_designation_e"
          />
          <FieldError id="uf_designation_e" message={errors.designation} />
        </label>
        <label className="f" htmlFor="uf_role">
          Role *
          <select
            id="uf_role"
            value={v.role_id}
            onChange={set('role_id')}
            aria-invalid={bad('role_id')}
            aria-describedby="uf_role_e"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <FieldError id="uf_role_e" message={errors.role_id} />
        </label>
        <label className="f" htmlFor="uf_mobile">
          Mobile *
          <input
            id="uf_mobile"
            type="text"
            inputMode="numeric"
            value={v.mobile}
            onChange={set('mobile')}
            aria-invalid={bad('mobile')}
            aria-describedby="uf_mobile_e"
          />
          <FieldError id="uf_mobile_e" message={errors.mobile} />
        </label>
        <label className="f" htmlFor="uf_email">
          Email
          <input
            id="uf_email"
            type="text"
            value={v.email}
            onChange={set('email')}
            aria-invalid={bad('email')}
            aria-describedby="uf_email_e"
          />
          <FieldError id="uf_email_e" message={errors.email} />
        </label>
      </div>
      <p role="alert" className="err">
        {formError}
      </p>
      <div className="row">
        <button type="submit" className="btn" disabled={busy}>
          {mode === 'add' ? 'Create user and login' : 'Save changes'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
