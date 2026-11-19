import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../../api/client';
import { createLinkNurse, updateLinkNurse } from '../../../api/linkNurses';
import { listDepartments } from '../../../api/masters';
import type { LinkNurse, LinkNurseWithPassword } from '../../../api/types';
import { Drawer } from '../../../components/Drawer';
import { todayIso } from '../../../lib/format';
import { WardChecklist } from './WardChecklist';
import { useWardOptions } from './WardsDrawer';
import m from '../../admin/masters/masters.module.css';

const EMP_RE = /^[A-Za-z0-9_-]{3,20}$/;
export const DESIGNATIONS = ['Staff Nurse', 'Sister', 'Nurse Educator', 'Ward In-charge'];

interface Values {
  employee_id: string;
  full_name: string;
  designation: string;
  department_id: string;
  mobile: string;
  email: string;
  link_nurse_from: string;
  who5_training_date: string;
  ward_ids: string[];
}

/** Client-side checks that mirror the server; the server stays the authority. */
export function validateLinkNurse(v: Values, mode: 'add' | 'edit'): Record<string, string> {
  const e: Record<string, string> = {};
  if (mode === 'add') {
    if (!v.employee_id) e.employee_id = 'Enter the employee ID.';
    else if (!EMP_RE.test(v.employee_id))
      e.employee_id = 'Employee ID must be 3 to 20 characters: letters, numbers, - or _.';
  }
  if (!v.full_name) e.full_name = 'Enter the full name.';
  if (!v.designation) e.designation = 'Enter the designation.';
  if (!v.department_id) e.department_id = 'Choose a department.';
  if (!/^\d{10}$/.test(v.mobile)) e.mobile = 'Enter a 10-digit mobile number.';
  if (!v.link_nurse_from) e.link_nurse_from = 'Choose the date they became a link nurse.';
  if (mode === 'add' && v.ward_ids.length === 0) e.ward_ids = 'Choose at least one ward.';
  return e;
}

/** Add (creates the login too) or edit a link nurse. Wards are changed with the Wards action. */
export function LinkNurseDrawer({
  nurse,
  onCreated,
  onSaved,
  onClose,
}: {
  nurse?: LinkNurse;
  onCreated: (res: LinkNurseWithPassword) => void;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const mode = nurse ? 'edit' : 'add';
  const [v, setV] = useState<Values>({
    employee_id: nurse?.employee_id ?? '',
    full_name: nurse?.full_name ?? '',
    designation: nurse?.designation ?? '',
    department_id: nurse?.department.id ?? '',
    mobile: nurse?.mobile ?? '',
    email: nurse?.email ?? '',
    link_nurse_from: nurse?.link_nurse_from ?? todayIso(),
    who5_training_date: nurse?.who5_training_date ?? '',
    ward_ids: [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  const departments = useQuery({
    queryKey: ['masters', 'departments', 'active-options'],
    queryFn: () => listDepartments({ status: 'Active', page_size: 500 }),
  });
  const wards = useWardOptions();

  const deptOptions: { id: string; name: string; inactive?: boolean }[] = (
    departments.data?.items ?? []
  ).map((d) => ({ id: d.id, name: d.name }));
  if (nurse && !deptOptions.some((d) => d.id === nurse.department.id))
    deptOptions.push({ ...nurse.department, inactive: true });

  const set = (k: keyof Values) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const id = (k: string) => `ln-${k}`;
  const bad = (k: string) => (errors[k] ? true : undefined);
  const fieldErr = (k: string) =>
    errors[k] && (
      <span className="err" role="alert">
        {errors[k]}
      </span>
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError('');
    const clean: Values = {
      ...v,
      employee_id: v.employee_id.trim(),
      full_name: v.full_name.trim(),
      designation: v.designation.trim(),
      mobile: v.mobile.trim(),
      email: v.email.trim(),
    };
    const found = validateLinkNurse(clean, mode);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      if (nurse) {
        await updateLinkNurse(nurse.id, {
          full_name: clean.full_name,
          designation: clean.designation,
          department_id: clean.department_id,
          mobile: clean.mobile,
          email: clean.email,
          link_nurse_from: clean.link_nurse_from,
          who5_training_date: clean.who5_training_date || null,
        });
        onSaved(`Saved ${clean.full_name}.`);
      } else {
        const res = await createLinkNurse({
          employee_id: clean.employee_id,
          full_name: clean.full_name,
          designation: clean.designation,
          department_id: clean.department_id,
          mobile: clean.mobile,
          ...(clean.email ? { email: clean.email } : {}),
          link_nurse_from: clean.link_nurse_from,
          ...(clean.who5_training_date ? { who5_training_date: clean.who5_training_date } : {}),
          ward_ids: clean.ward_ids,
        });
        onCreated(res);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const byField: Record<string, string> = {};
        for (const d of err.details) byField[d.field] = d.message;
        // A duplicate employee ID comes back as 409 without field details.
        if (mode === 'add' && err.status === 409 && err.details.length === 0)
          byField.employee_id = err.message;
        setErrors(byField);
        setServerError(Object.keys(byField).length ? '' : err.message);
      } else setServerError('Something went wrong. Try again.');
      setBusy(false);
    }
  }

  const formId = 'ln-form';
  return (
    <Drawer
      wide
      title={nurse ? 'Edit link nurse' : 'Add link nurse'}
      description={
        nurse
          ? `Change the details of ${nurse.full_name}.`
          : 'This also creates their login. A temporary password is shown once.'
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn" disabled={busy}>
            {nurse ? 'Save changes' : 'Create link nurse and login'}
          </button>
        </>
      }
    >
      <form id={formId} className={m.form} onSubmit={(e) => void submit(e)} noValidate>
        <label className="f" htmlFor={id('emp')}>
          Employee ID (username) *
          <input
            id={id('emp')}
            type="text"
            maxLength={20}
            value={v.employee_id}
            readOnly={mode === 'edit'}
            data-autofocus={mode === 'add' ? true : undefined}
            onChange={set('employee_id')}
            aria-invalid={bad('employee_id')}
          />
          {mode === 'edit' && <span className={m.hint}>The employee ID cannot be changed.</span>}
          {fieldErr('employee_id')}
        </label>
        <label className="f" htmlFor={id('name')}>
          Full name *
          <input
            id={id('name')}
            type="text"
            maxLength={100}
            value={v.full_name}
            onChange={set('full_name')}
            aria-invalid={bad('full_name')}
          />
          {fieldErr('full_name')}
        </label>
        <label className="f" htmlFor={id('designation')}>
          Designation *
          <input
            id={id('designation')}
            type="text"
            list="ln-designations"
            maxLength={100}
            value={v.designation}
            onChange={set('designation')}
            aria-invalid={bad('designation')}
          />
          <datalist id="ln-designations">
            {DESIGNATIONS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          {fieldErr('designation')}
        </label>
        <label className="f" htmlFor={id('dept')}>
          Department *
          <select
            id={id('dept')}
            value={v.department_id}
            onChange={set('department_id')}
            aria-invalid={bad('department_id')}
          >
            <option value="">Choose a department</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.inactive ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
          {fieldErr('department_id')}
        </label>
        <label className="f" htmlFor={id('mobile')}>
          Mobile *
          <input
            id={id('mobile')}
            type="text"
            inputMode="numeric"
            maxLength={10}
            value={v.mobile}
            onChange={set('mobile')}
            aria-invalid={bad('mobile')}
          />
          <span className={m.hint}>10 digits.</span>
          {fieldErr('mobile')}
        </label>
        <label className="f" htmlFor={id('email')}>
          Email
          <input
            id={id('email')}
            type="text"
            value={v.email}
            onChange={set('email')}
            aria-invalid={bad('email')}
          />
          {fieldErr('email')}
        </label>
        <label className="f" htmlFor={id('from')}>
          Link nurse from *
          <input
            id={id('from')}
            type="date"
            value={v.link_nurse_from}
            onChange={set('link_nurse_from')}
            aria-invalid={bad('link_nurse_from')}
          />
          {fieldErr('link_nurse_from')}
        </label>
        <label className="f" htmlFor={id('who5')}>
          WHO 5 Moments training date
          <input
            id={id('who5')}
            type="date"
            value={v.who5_training_date}
            onChange={set('who5_training_date')}
            aria-invalid={bad('who5_training_date')}
          />
          {fieldErr('who5_training_date')}
        </label>
        {mode === 'add' ? (
          <WardChecklist
            options={wards.options}
            selected={v.ward_ids}
            onChange={(ids) => setV((p) => ({ ...p, ward_ids: ids }))}
            loading={wards.query.isPending}
            error={errors.ward_ids}
          />
        ) : (
          <p className="small muted">
            Change wards with the Wards action so the assignment history is kept.
          </p>
        )}
        {serverError && (
          <p role="alert" className="err">
            {serverError}
          </p>
        )}
      </form>
    </Drawer>
  );
}
