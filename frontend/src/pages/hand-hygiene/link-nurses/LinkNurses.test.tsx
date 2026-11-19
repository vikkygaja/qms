import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../../app/App';
import { todayIso } from '../../../lib/format';
import {
  DEPT_GEN,
  DEPT_ICU,
  icnMe,
  makeAudit,
  makeLinkNurse,
  makeLinkNurseDetail,
  nurseMe,
  page,
  SUMMARY,
  WARD_MICU,
  WARD_SICU,
} from '../../../test/fixtures';
import {
  apiError,
  mockApi,
  renderWithAuth,
  withSession,
  type ApiCall,
  type ApiHandler,
} from '../../../test/utils';
import type { Me } from '../../../api/types';

const PRIYA = makeLinkNurse({
  wards: [
    { id: 'w1', name: 'MICU' },
    { id: 'w2', name: 'SICU' },
    { id: 'w3', name: 'CCU' },
    { id: 'w4', name: 'NICU' },
    { id: 'w5', name: 'PICU' },
  ],
  sessions_this_month: 12,
  last_entry_date: '2026-11-01',
  no_entry_flag: true,
});
const ARUN = makeLinkNurse({
  id: 'ln2',
  employee_id: 'SN1002',
  full_name: 'Arun K.',
  designation: 'Staff Nurse',
  department: { id: 'd2', name: 'General Medicine' },
  must_change_password: true,
  wards: [],
});
const GONE = makeLinkNurse({
  id: 'ln3',
  employee_id: 'SN1003',
  full_name: 'Meena S.',
  status: 'Inactive',
  wards: [],
});

const lastList = (calls: ApiCall[]) => [...calls].reverse().find((c) => c.path === '/link-nurses')!;

const api = (extra: ApiHandler = () => undefined, me: Me = icnMe): ApiHandler =>
  withSession(me, (c) => {
    const r = extra(c);
    if (r) return r;
    if (c.method !== 'GET') return undefined;
    if (c.path === '/link-nurses') return { body: page([PRIYA, ARUN]) };
    if (c.path === '/link-nurses/recent-changes')
      return {
        body: [
          makeAudit({
            id: 7,
            entity: 'link_nurse',
            summary: 'Assigned MICU, SICU to Priya R. (SN1001)',
            actor: { id: 'u-icn', employee_id: 'ICN001', full_name: 'Sr. Mary J.' },
          }),
        ],
      };
    if (/^\/link-nurses\/ln\d$/.test(c.path)) return { body: makeLinkNurseDetail() };
    if (c.path === '/wards') return { body: page([WARD_MICU, WARD_SICU]) };
    if (c.path === '/departments') return { body: page([DEPT_ICU, DEPT_GEN]) };
    if (c.path === '/settings/kpi') return { body: SUMMARY.kpi };
    return undefined;
  });

async function open(route = '/hand-hygiene/link-nurses', extra?: ApiHandler, me?: Me) {
  const m = mockApi(api(extra, me));
  renderWithAuth(<AppRoutes />, route);
  await screen.findByRole('main');
  return { ...m, user: userEvent.setup() };
}
async function openLoaded(extra?: ApiHandler, anchor = 'SN1001') {
  const r = await open(undefined, extra);
  await screen.findByText(anchor);
  return r;
}
const rowOf = (id: string) => screen.getByText(id).closest('tr')!;

afterEach(() => vi.unstubAllGlobals());

describe('Link nurses route', () => {
  it('shows No access without the ln permission', async () => {
    const { calls } = await open(undefined, undefined, nurseMe);
    expect(await screen.findByText('No access')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/link-nurses')).toBe(false);
  });
});

describe('Link nurses list', () => {
  it('renders rows with ward chips, pills and the header', async () => {
    const { calls } = await openLoaded();
    const q = lastList(calls).query;
    expect(q.get('status')).toBe('Active');
    expect(q.get('page_size')).toBe('50');
    expect(screen.getByRole('heading', { level: 1, name: 'Link nurses' })).toBeInTheDocument();
    expect(screen.getByText('2 link nurses')).toBeInTheDocument();
    expect(screen.getByText(/also creates their login/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add link nurse' })).toBeInTheDocument();

    const priya = within(rowOf('SN1001'));
    expect(priya.getByText('Priya R.')).toBeInTheDocument();
    expect(priya.getByText('Sister - Critical Care')).toBeInTheDocument();
    for (const w of ['MICU', 'SICU', 'CCU']) expect(priya.getByText(w)).toBeInTheDocument();
    expect(priya.queryByText('NICU')).not.toBeInTheDocument();
    expect(priya.getByText('+2')).toHaveAttribute('title', 'NICU, PICU');
    expect(priya.getByText('12')).toBeInTheDocument();
    expect(priya.getByText('1 Nov 2026')).toBeInTheDocument();
    await waitFor(() => expect(priya.getByText('No entry 10+ days')).toBeInTheDocument());
    expect(priya.getByText('Active')).toBeInTheDocument();
    expect(priya.queryByText('First login pending')).not.toBeInTheDocument();

    const arun = within(rowOf('SN1002'));
    expect(arun.getByText('None')).toBeInTheDocument();
    expect(arun.getByText('First login pending')).toBeInTheDocument();
    expect(arun.getByText('-', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows the recent changes card with times in Asia/Kolkata', async () => {
    await openLoaded();
    const card = screen.getByRole('region', { name: 'Recent changes' });
    expect(await within(card).findByText('Assigned MICU, SICU to Priya R. (SN1001)')).toBeVisible();
    expect(within(card).getByText('Sr. Mary J.')).toBeInTheDocument();
    expect(within(card).getByText(/3:30/)).toBeInTheDocument();
  });

  it('offers Wards and Reset password only to Active nurses', async () => {
    await openLoaded((c) =>
      c.path === '/link-nurses' ? { body: page([PRIYA, GONE]) } : undefined,
    );
    const act = within(rowOf('SN1001'));
    for (const n of ['Edit', 'Wards', 'History', 'Reset password', 'Make inactive'])
      expect(act.getByRole('button', { name: `${n}: Priya R.` })).toBeInTheDocument();
    const off = within(rowOf('SN1003'));
    expect(off.getByRole('button', { name: 'Edit: Meena S.' })).toBeInTheDocument();
    expect(off.getByRole('button', { name: 'History: Meena S.' })).toBeInTheDocument();
    expect(off.getByRole('button', { name: 'Make active: Meena S.' })).toBeInTheDocument();
    expect(off.queryByRole('button', { name: /Wards:/ })).not.toBeInTheDocument();
    expect(off.queryByRole('button', { name: /Reset password/ })).not.toBeInTheDocument();
  });

  it('restores search, ward, status, sort, page and page size from the URL', async () => {
    const { calls } = await open(
      '/hand-hygiene/link-nurses?q=pri&ward_id=w1&status=inactive&sort=employee_id&order=desc&page=2&page_size=25',
      (c) =>
        c.path === '/link-nurses' ? { body: { ...page([PRIYA]), total: 60, page: 2 } } : undefined,
    );
    await screen.findByText('SN1001');
    expect(Object.fromEntries(lastList(calls).query)).toEqual({
      q: 'pri',
      ward_id: 'w1',
      status: 'Inactive',
      sort: 'employee_id',
      order: 'desc',
      page: '2',
      page_size: '25',
    });
    expect(screen.getByLabelText('Search link nurses')).toHaveValue('pri');
    expect(screen.getByLabelText('Status')).toHaveValue('inactive');
    expect(screen.getByLabelText('Rows per page')).toHaveValue('25');
    expect(await screen.findByLabelText('Ward')).toHaveValue('w1');
    expect(screen.getByText('Showing 26-50 of 60')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Employee ID/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('loads Active wards for the filter and applies filters, search and sort', async () => {
    const { calls, user } = await openLoaded();
    const wardCall = calls.find((c) => c.path === '/wards')!;
    expect(wardCall.query.get('status')).toBe('Active');
    expect(wardCall.query.get('page_size')).toBe('500');
    await user.selectOptions(await screen.findByLabelText('Ward'), 'w2');
    await waitFor(() => expect(lastList(calls).query.get('ward_id')).toBe('w2'));
    await user.selectOptions(screen.getByLabelText('Status'), 'All');
    await waitFor(() => expect(lastList(calls).query.has('status')).toBe(false));
    await user.selectOptions(screen.getByLabelText('Rows per page'), '100');
    await waitFor(() => expect(lastList(calls).query.get('page_size')).toBe('100'));
    await user.type(screen.getByLabelText('Search link nurses'), 'sn10');
    await waitFor(() => expect(lastList(calls).query.get('q')).toBe('sn10'));
    await user.click(screen.getByRole('button', { name: 'Employee ID' }));
    await waitFor(() => expect(lastList(calls).query.get('sort')).toBe('employee_id'));
    await user.click(screen.getByRole('button', { name: 'Status' }));
    await waitFor(() => expect(lastList(calls).query.get('sort')).toBe('status'));
    await user.click(screen.getByRole('button', { name: 'Status' }));
    await waitFor(() => expect(lastList(calls).query.get('order')).toBe('desc'));
  });

  it('shows the first-time empty state with an add button', async () => {
    const { user } = await open(undefined, (c) =>
      c.path === '/link-nurses' ? { body: page([]) } : undefined,
    );
    expect(await screen.findByText('No link nurses yet')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Add link nurse/ })[1]);
    expect(await screen.findByRole('dialog', { name: 'Add link nurse' })).toBeInTheDocument();
  });

  it('shows the no-match state and clears the filters', async () => {
    const { calls, user } = await open('/hand-hygiene/link-nurses?q=zzz', (c) =>
      c.path === '/link-nurses' && c.query.get('q') ? { body: page([]) } : undefined,
    );
    expect(await screen.findByText('No link nurses match these filters')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByText('SN1001')).toBeInTheDocument();
    expect(lastList(calls).query.has('q')).toBe(false);
  });

  it('shows an error with a retry when the list fails', async () => {
    await open(undefined, (c) =>
      c.path === '/link-nurses' ? apiError(500, 'server_error', 'Boom.') : undefined,
    );
    expect(await screen.findByText('Boom.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

async function fillAdd(
  user: ReturnType<typeof userEvent.setup>,
  dlg: HTMLElement,
  over: { emp?: string; mobile?: string } = {},
) {
  await user.type(within(dlg).getByLabelText(/^Employee ID/), over.emp ?? 'sn2001');
  await user.type(within(dlg).getByLabelText(/^Full name/), 'Kavya M.');
  await user.type(within(dlg).getByLabelText(/^Designation/), 'Staff Nurse');
  await user.selectOptions(await within(dlg).findByLabelText(/^Department/), 'd1');
  await user.type(within(dlg).getByLabelText(/^Mobile/), over.mobile ?? '9840011111');
}

describe('Add link nurse', () => {
  it('validates required fields, mobile and at least one ward before calling the server', async () => {
    const { calls, user } = await openLoaded();
    await user.click(screen.getByRole('button', { name: 'Add link nurse' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add link nurse' });
    expect(within(dlg).getByLabelText(/^Link nurse from/)).toHaveValue(todayIso());
    await user.click(within(dlg).getByRole('button', { name: 'Create link nurse and login' }));
    expect(await within(dlg).findByText('Enter the employee ID.')).toBeInTheDocument();
    expect(within(dlg).getByText('Enter the full name.')).toBeInTheDocument();
    expect(within(dlg).getByText('Enter the designation.')).toBeInTheDocument();
    expect(within(dlg).getByText('Choose a department.')).toBeInTheDocument();
    expect(within(dlg).getByText('Enter a 10-digit mobile number.')).toBeInTheDocument();
    expect(within(dlg).getByText('Choose at least one ward.')).toBeInTheDocument();
    await fillAdd(user, dlg, { mobile: '98400' });
    await user.click(within(dlg).getByRole('button', { name: 'Create link nurse and login' }));
    expect(await within(dlg).findByText('Enter a 10-digit mobile number.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('suggests designations and lists only Active departments', async () => {
    const { calls, user } = await openLoaded();
    await user.click(screen.getByRole('button', { name: 'Add link nurse' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add link nurse' });
    const list = dlg.querySelector('datalist')!;
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual([
      'Staff Nurse',
      'Sister',
      'Nurse Educator',
      'Ward In-charge',
    ]);
    await within(dlg).findByRole('option', { name: 'Critical Care' });
    expect(calls.some((c) => c.path === '/departments' && c.query.get('status') === 'Active')).toBe(
      true,
    );
  });

  it('searches wards, shows chips and a count, and creates the nurse with the CSRF header', async () => {
    const created = {
      link_nurse: makeLinkNurseDetail({ full_name: 'Kavya M.', employee_id: 'SN2001' }),
      temporary_password: 'Tmp-Pass-1',
    };
    const { calls, user } = await openLoaded((c) =>
      c.method === 'POST' && c.path === '/link-nurses' ? { status: 201, body: created } : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Add link nurse' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add link nurse' });
    await fillAdd(user, dlg);
    await user.type(within(dlg).getByLabelText(/^Email/), 'k@example.org');
    await user.type(await within(dlg).findByLabelText('Search wards'), 'SIC');
    expect(within(dlg).queryByRole('checkbox', { name: /MICU/ })).not.toBeInTheDocument();
    expect(within(dlg).getByText('0 selected')).toBeInTheDocument();
    await user.click(within(dlg).getByRole('checkbox', { name: /SICU/ }));
    await user.clear(within(dlg).getByLabelText('Search wards'));
    await user.click(within(dlg).getByRole('checkbox', { name: /MICU/ }));
    expect(within(dlg).getByText('2 selected')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Remove MICU' })).toBeInTheDocument();
    expect(within(dlg).getByText(/3 assigned/)).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText(/^Link nurse from/), {
      target: { value: '2026-11-01' },
    });
    fireEvent.change(within(dlg).getByLabelText(/^WHO 5/), { target: { value: '2026-10-20' } });
    await user.click(within(dlg).getByRole('button', { name: 'Create link nurse and login' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({
      employee_id: 'sn2001',
      full_name: 'Kavya M.',
      designation: 'Staff Nurse',
      department_id: 'd1',
      mobile: '9840011111',
      email: 'k@example.org',
      link_nurse_from: '2026-11-01',
      who5_training_date: '2026-10-20',
      ward_ids: ['w2', 'w1'],
    });
    expect(post.headers.get('X-CSRF-Token')).toBe('csrf-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Added Kavya M..')).toBeInTheDocument();
    const box = screen.getByRole('group', { name: 'Temporary password' });
    expect(within(box).getByText('Login created for Kavya M.')).toBeInTheDocument();
    expect(within(box).getByText('SN2001')).toBeInTheDocument();
    expect(within(box).getByText('Tmp-Pass-1')).toBeInTheDocument();
    expect(within(box).getByText(/must set a new password at first login/)).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Tmp-Pass-1')).not.toBeInTheDocument();
  });

  it('copies the login details from the secret box', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { user } = await openLoaded((c) =>
      c.method === 'POST' && c.path === '/link-nurses'
        ? {
            status: 201,
            body: { link_nurse: makeLinkNurseDetail(), temporary_password: 'Tmp-Pass-2' },
          }
        : undefined,
    );
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Add link nurse' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add link nurse' });
    await fillAdd(user, dlg);
    await user.click(await within(dlg).findByRole('checkbox', { name: /MICU/ }));
    await user.click(within(dlg).getByRole('button', { name: 'Create link nurse and login' }));
    const box = await screen.findByRole('group', { name: 'Temporary password' });
    await user.click(within(box).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Tmp-Pass-2'));
    expect(await within(box).findByText('Copied.')).toBeInTheDocument();
  });

  it('shows the duplicate employee ID (409) next to the field and keeps the drawer open', async () => {
    const { user } = await openLoaded((c) =>
      c.method === 'POST' && c.path === '/link-nurses'
        ? apiError(409, 'conflict', 'This employee ID already has a login.')
        : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Add link nurse' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add link nurse' });
    await fillAdd(user, dlg);
    await user.click(await within(dlg).findByRole('checkbox', { name: /MICU/ }));
    await user.click(within(dlg).getByRole('button', { name: 'Create link nurse and login' }));
    const msg = await within(dlg).findByText('This employee ID already has a login.');
    expect(msg.closest('label')).toHaveTextContent(/Employee ID/);
    expect(screen.queryByRole('group', { name: 'Temporary password' })).not.toBeInTheDocument();
  });

  it('shows server field errors next to the inputs', async () => {
    const { user } = await openLoaded((c) =>
      c.method === 'POST' && c.path === '/link-nurses'
        ? apiError(422, 'validation_error', 'Check the highlighted fields.', [
            { field: 'mobile', message: 'Mobile is already used.' },
            { field: 'ward_ids', message: 'Pick Active wards only.' },
          ])
        : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Add link nurse' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add link nurse' });
    await fillAdd(user, dlg);
    await user.click(await within(dlg).findByRole('checkbox', { name: /MICU/ }));
    await user.click(within(dlg).getByRole('button', { name: 'Create link nurse and login' }));
    expect(await within(dlg).findByText('Mobile is already used.')).toBeInTheDocument();
    expect(within(dlg).getByText('Pick Active wards only.')).toBeInTheDocument();
  });
});

describe('Edit link nurse', () => {
  it('keeps the employee ID read-only, explains wards, and sends a PATCH', async () => {
    const { calls, user } = await openLoaded((c) =>
      c.method === 'PATCH' && c.path === '/link-nurses/ln1'
        ? { body: makeLinkNurseDetail() }
        : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Edit: Priya R.' }));
    const dlg = await screen.findByRole('dialog', { name: 'Edit link nurse' });
    expect(within(dlg).getByLabelText(/^Employee ID/)).toHaveAttribute('readonly');
    expect(within(dlg).getByLabelText(/^Employee ID/)).toHaveValue('SN1001');
    expect(within(dlg).getByText(/Change wards with the Wards action/)).toBeInTheDocument();
    expect(within(dlg).queryByLabelText('Search wards')).not.toBeInTheDocument();
    const mobile = within(dlg).getByLabelText(/^Mobile/);
    await user.clear(mobile);
    await user.type(mobile, '9840099999');
    await user.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({
      full_name: 'Priya R.',
      designation: 'Sister',
      department_id: 'd1',
      mobile: '9840099999',
      email: '',
      link_nurse_from: '2026-01-05',
      who5_training_date: '2026-01-10',
    });
    expect(patch.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(await screen.findByText('Saved Priya R..')).toBeInTheDocument();
  });
});

describe('Wards drawer', () => {
  async function openWards(extra?: ApiHandler) {
    const r = await openLoaded(extra);
    await r.user.click(screen.getByRole('button', { name: 'Wards: Priya R.' }));
    const dlg = await screen.findByRole('dialog', { name: 'Wards: Priya R.' });
    return { ...r, dlg };
  }

  it('pre-ticks current wards, shows link nurse counts and renders the history', async () => {
    const { dlg } = await openWards((c) =>
      c.path === '/link-nurses/ln1'
        ? { body: makeLinkNurseDetail() }
        : c.path === '/link-nurses'
          ? { body: page([makeLinkNurse(), ARUN]) }
          : undefined,
    );
    const micu = await within(dlg).findByRole('checkbox', { name: /MICU/ });
    expect(micu).toBeChecked();
    expect(within(dlg).getByRole('checkbox', { name: /SICU/ })).not.toBeChecked();
    expect(within(dlg).getByText(/3 assigned/)).toBeInTheDocument();
    expect(within(dlg).getByText(/0 assigned/)).toBeInTheDocument();
    expect(within(dlg).getByText('1 selected')).toBeInTheDocument();
    const hist = await within(dlg).findByRole('table', { name: 'Assignment history' });
    expect(within(hist).getByText('1 Jun 2026')).toBeInTheDocument();
    expect(within(hist).getByText('Current')).toBeInTheDocument();
    expect(within(hist).getByText('Old Ward')).toBeInTheDocument();
    expect(within(hist).getByText('31 May 2026')).toBeInTheDocument();
    const st = within(dlg).getByRole('table', { name: 'Status history' });
    expect(within(st).getByText('Active to Inactive')).toBeInTheDocument();
    expect(within(st).getByText('Long leave')).toBeInTheDocument();
    expect(within(st).getByText('Sr. Mary J.')).toBeInTheDocument();
  });

  it('enforces keep-at-least-one-ward on the client', async () => {
    const { calls, dlg, user } = await openWards((c) =>
      c.path === '/link-nurses' ? { body: page([makeLinkNurse(), ARUN]) } : undefined,
    );
    await user.click(await within(dlg).findByRole('checkbox', { name: /MICU/ }));
    await user.click(within(dlg).getByRole('button', { name: 'Save wards' }));
    expect(
      await within(dlg).findByText(
        'Keep at least one ward, or make the link nurse inactive instead.',
      ),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('saves the full set of ward ids with PUT and the CSRF header', async () => {
    const { calls, dlg, user } = await openWards((c) =>
      c.method === 'PUT' && c.path === '/link-nurses/ln1/wards'
        ? { body: makeLinkNurseDetail() }
        : c.path === '/link-nurses'
          ? { body: page([makeLinkNurse(), ARUN]) }
          : undefined,
    );
    await user.click(await within(dlg).findByRole('checkbox', { name: /SICU/ }));
    await user.click(within(dlg).getByRole('button', { name: 'Save wards' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toEqual({ ward_ids: ['w1', 'w2'] });
    expect(put.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(await screen.findByText('Wards updated for Priya R..')).toBeInTheDocument();
  });

  it('shows the server message when saving fails', async () => {
    const { dlg, user } = await openWards((c) =>
      c.method === 'PUT'
        ? apiError(409, 'conflict', 'Make the link nurse active first.')
        : c.path === '/link-nurses'
          ? { body: page([makeLinkNurse(), ARUN]) }
          : undefined,
    );
    await user.click(await within(dlg).findByRole('checkbox', { name: /SICU/ }));
    await user.click(within(dlg).getByRole('button', { name: 'Save wards' }));
    expect(await within(dlg).findByText('Make the link nurse active first.')).toBeInTheDocument();
  });

  it('History opens the same history read-only', async () => {
    const { user } = await openLoaded();
    await user.click(screen.getByRole('button', { name: 'History: Priya R.' }));
    const dlg = await screen.findByRole('dialog', { name: 'History: Priya R.' });
    expect(await within(dlg).findByRole('table', { name: 'Assignment history' })).toBeVisible();
    expect(within(dlg).getByRole('table', { name: 'Status history' })).toBeVisible();
    expect(within(dlg).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Save wards' })).not.toBeInTheDocument();
  });
});

describe('Status dialog', () => {
  it('requires a reason, refuses a future date and posts reason and effective date', async () => {
    const { calls, user } = await openLoaded((c) =>
      c.method === 'POST' && c.path === '/link-nurses/ln1/status'
        ? { body: makeLinkNurseDetail({ status: 'Inactive' }) }
        : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Make inactive: Priya R.' }));
    const dlg = await screen.findByRole('dialog', { name: 'Make Priya R. inactive?' });
    expect(within(dlg).getByText(/blocks their login and ends all their ward/)).toBeInTheDocument();
    const date = within(dlg).getByLabelText('Effective date');
    expect(date).toHaveValue(todayIso());
    expect(date).toHaveAttribute('max', todayIso());
    await user.click(within(dlg).getByRole('button', { name: 'Make inactive' }));
    expect(await within(dlg).findByText('Enter a reason.')).toBeInTheDocument();
    await user.type(within(dlg).getByLabelText(/Reason/), 'Long leave');
    fireEvent.change(date, { target: { value: '2999-01-01' } });
    await user.click(within(dlg).getByRole('button', { name: 'Make inactive' }));
    expect(await within(dlg).findByText('The date cannot be in the future.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.change(date, { target: { value: '2026-11-10' } });
    await user.click(within(dlg).getByRole('button', { name: 'Make inactive' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({
      status: 'Inactive',
      reason: 'Long leave',
      effective_date: '2026-11-10',
    });
    expect(post.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(await screen.findByText('Priya R. is now Inactive.')).toBeInTheDocument();
  });

  it('explains that making active does not restore wards', async () => {
    const { calls, user } = await openLoaded(
      (c) =>
        c.path === '/link-nurses'
          ? { body: page([GONE]) }
          : c.method === 'POST' && c.path === '/link-nurses/ln3/status'
            ? { body: makeLinkNurseDetail() }
            : undefined,
      'SN1003',
    );
    await user.click(screen.getByRole('button', { name: 'Make active: Meena S.' }));
    const dlg = await screen.findByRole('dialog', { name: 'Make Meena S. active?' });
    expect(within(dlg).getByText(/does not restore their wards/)).toBeInTheDocument();
    await user.type(within(dlg).getByLabelText(/Reason/), 'Back from leave');
    await user.click(within(dlg).getByRole('button', { name: 'Make active' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ status: 'Active' });
    expect(await screen.findByText(/Assign wards to resume entries/)).toBeInTheDocument();
  });

  it('shows the server message when the change is refused', async () => {
    const { user } = await openLoaded((c) =>
      c.method === 'POST' ? apiError(409, 'conflict', 'Already inactive.') : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Make inactive: Priya R.' }));
    const dlg = await screen.findByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Reason/), 'x');
    await user.click(within(dlg).getByRole('button', { name: 'Make inactive' }));
    expect(await within(dlg).findByText('Already inactive.')).toBeInTheDocument();
  });
});

describe('Reset password', () => {
  it('confirms, posts with CSRF and shows the one-time secret box', async () => {
    const { calls, user } = await openLoaded((c) =>
      c.method === 'POST' && c.path === '/link-nurses/ln1/reset-password'
        ? { body: { link_nurse: makeLinkNurseDetail(), temporary_password: 'Reset-Pw-9' } }
        : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Reset password: Priya R.' }));
    const dlg = await screen.findByRole('dialog', { name: 'Reset password for Priya R.?' });
    expect(within(dlg).getByText(/ends all their sessions/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await user.click(within(dlg).getByRole('button', { name: 'Reset password' }));
    const box = await screen.findByRole('group', { name: 'Temporary password' });
    expect(within(box).getByText('Password reset for Priya R.')).toBeInTheDocument();
    expect(within(box).getByText('Reset-Pw-9')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.headers.get('X-CSRF-Token')).toBe('csrf-1');
    await user.click(within(box).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Reset-Pw-9')).not.toBeInTheDocument();
  });

  it('shows the server message when the reset is refused', async () => {
    const { user } = await openLoaded((c) =>
      c.method === 'POST' ? apiError(409, 'conflict', 'Only active nurses.') : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Reset password: Priya R.' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Reset password' }));
    expect(await within(dlg).findByText('Only active nurses.')).toBeInTheDocument();
  });
});
