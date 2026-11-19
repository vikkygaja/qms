import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../../api/client';
import { createMaster, listDepartments, updateMaster } from '../../../api/masters';
import type { Department, MasterKind, StaffCategory, Ward } from '../../../api/types';
import { Drawer } from '../../../components/Drawer';
import s from './masters.module.css';

export type MasterItem = Department | Ward | StaffCategory;

interface Values {
  name: string;
  department_id: string;
  monthly_target: string;
  code: string;
}
const EMPTY: Values = { name: '', department_id: '', monthly_target: '40', code: '' };

const LABEL: Record<MasterKind, { singular: string; name: string }> = {
  wards: { singular: 'ward', name: 'Ward name' },
  departments: { singular: 'department', name: 'Department name' },
  'staff-categories': { singular: 'staff category', name: 'Category name' },
};

function valuesOf(kind: MasterKind, item: MasterItem): Values {
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

/** Right-side panel to add or edit one master item. Closes itself through onSaved or onClose. */
export function MasterDrawer({
  kind,
  item,
  onSaved,
  onClose,
}: {
  kind: MasterKind;
  item?: MasterItem;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const lbl = LABEL[kind];
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
  const formId = `${kind}-form`;

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
      onSaved(item ? `Saved ${v.name.trim()}.` : `Added ${v.name.trim()}.`);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields: Record<string, string> = {};
        for (const d of err.details) fields[d.field] = d.message;
        setErrors(fields);
        if (err.details.length === 0) setServerError(err.message);
      } else setServerError('Something went wrong. Try again.');
      setBusy(false);
    }
  }

  const fieldErr = (k: string) =>
    errors[k] && (
      <span className="err" role="alert">
        {errors[k]}
      </span>
    );

  // Active departments, plus the ward's current department even if it is now Inactive.
  const options: { id: string; name: string; inactive?: boolean }[] = (
    departments.data?.items ?? []
  ).map((d) => ({ id: d.id, name: d.name }));
  if (item && kind === 'wards') {
    const cur = (item as Ward).department;
    if (!options.some((d) => d.id === cur.id))
      options.push({ id: cur.id, name: cur.name, inactive: true });
  }

  return (
    <Drawer
      title={item ? `Edit ${lbl.singular}` : `Add ${lbl.singular}`}
      description={
        item
          ? `Change the details of ${item.name}.`
          : `Enter the details of the new ${lbl.singular}.`
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn" disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <form id={formId} className={s.form} onSubmit={(e) => void submit(e)} noValidate>
        <label className="f" htmlFor={id('name')}>
          {lbl.name}
          <input
            id={id('name')}
            type="text"
            maxLength={100}
            data-autofocus
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
                <option value="">Choose a department</option>
                {options.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.inactive ? ' (inactive)' : ''}
                  </option>
                ))}
              </select>
              {fieldErr('department_id')}
            </label>
            <label className="f" htmlFor={id('target')}>
              Monthly target (opportunities)
              <input
                id={id('target')}
                type="number"
                min={0}
                max={100000}
                value={v.monthly_target}
                onChange={set('monthly_target')}
                aria-invalid={!!errors.monthly_target}
              />
              <span className={s.hint}>Hand hygiene opportunities to observe each month.</span>
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
            <span className={s.hint}>Printed on the observation sheet. Must be unique.</span>
            {fieldErr('code')}
          </label>
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
