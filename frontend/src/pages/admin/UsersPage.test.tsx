import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { adminMe, makeAudit, makeUser, page, ROLES } from '../../test/fixtures';
import { apiError, mockApi, renderWithAuth, withSession, type ApiHandler } from '../../test/utils';
import { AppRoutes } from '../../app/App';

const nurse = makeUser({
  id: 'u3',
  employee_id: 'LN001',
  full_name: 'Priya R.',
  role: { id: 'r-ln', key: 'link_nurse', name: 'Link nurse' },
});
const base = (extra: ApiHandler = () => undefined): ApiHandler =>
  withSession(adminMe, (c) => {
    if (c.method === 'GET' && c.path === '/users')
      return {
        body: page([
          makeUser(),
          makeUser({
            id: 'u2',
            employee_id: 'QM001',
            full_name: 'Dr. Arun K.',
            status: 'Inactive',
            must_change_password: true,
          }),
          nurse,
        ]),
      };
    if (c.path === '/roles') return { body: ROLES };
    if (c.path === '/audit-log') return { body: page([makeAudit()]) };
    return extra(c);
  });

async function openUsers(extra?: ApiHandler) {
  const m = mockApi(base(extra));
  renderWithAuth(<AppRoutes />, '/admin/users');
  await screen.findByText('ICN001');
  return { ...m, user: userEvent.setup() };
}

describe('Users page', () => {
  it('lists users with status pills, first-login pill and link nurses read-only', async () => {
    await openUsers();
    const row = screen.getByText('QM001').closest('tr')!;
    expect(within(row).getByText('Inactive')).toBeInTheDocument();
    expect(within(row).getByText('First login pending')).toBeInTheDocument();
    const ln = screen.getByText('LN001').closest('tr')!;
    expect(within(ln).getByText('Managed by ICN (Link nurses page)')).toBeInTheDocument();
    expect(within(ln).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Created user Test ICN (ICN001) as ICN')).toBeInTheDocument();
  });

  it('shows audit time in Asia/Kolkata', async () => {
    await openUsers();
    expect(screen.getByText(/3:30/)).toBeInTheDocument();
  });

  it('sends search and status filters', async () => {
    const { calls, user } = await openUsers();
    await user.type(screen.getByLabelText(/Search name/), 'arun');
    await user.selectOptions(screen.getByLabelText('Status'), 'Inactive');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.path === '/users')!;
      expect(last.query.get('q')).toBe('arun');
      expect(last.query.get('status')).toBe('Inactive');
    });
  });

  it('validates the add form: required fields and 10-digit mobile', async () => {
    const { calls, user } = await openUsers();
    await user.click(screen.getByRole('button', { name: '+ Add user' }));
    await user.click(screen.getByRole('button', { name: 'Create user and login' }));
    expect(await screen.findByText('Enter the employee ID.')).toBeInTheDocument();
    expect(screen.getByText('Enter the full name.')).toBeInTheDocument();
    expect(screen.getByText('Enter the designation.')).toBeInTheDocument();
    expect(screen.getByText('Enter a 10-digit mobile number.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Mobile/), '12345');
    await user.click(screen.getByRole('button', { name: 'Create user and login' }));
    expect(screen.getByText('Enter a 10-digit mobile number.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('excludes the link nurse role from the role select', async () => {
    const { user } = await openUsers();
    await user.click(screen.getByRole('button', { name: '+ Add user' }));
    const opts = within(screen.getByLabelText(/Role/))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(opts).toEqual(['Admin', 'ICN']);
  });

  it('creates a user, shows the temporary password once, and clears it on Done', async () => {
    const { calls, user } = await openUsers((c) =>
      c.method === 'POST' && c.path === '/users'
        ? {
            status: 201,
            body: {
              user: makeUser({ id: 'n', employee_id: 'NEW01', full_name: 'New Person' }),
              temporary_password: 'Temp-Pass-77',
            },
          }
        : undefined,
    );
    await user.click(screen.getByRole('button', { name: '+ Add user' }));
    await user.type(screen.getByLabelText(/Employee ID/), 'new01');
    await user.type(screen.getByLabelText(/Full name/), 'New Person');
    await user.type(screen.getByLabelText(/Designation/), 'Nurse');
    await user.type(screen.getByLabelText(/Mobile/), '9840000009');
    await user.click(screen.getByRole('button', { name: 'Create user and login' }));
    const box = await screen.findByRole('group', { name: 'Temporary password' });
    expect(within(box).getByText('Temp-Pass-77')).toBeInTheDocument();
    expect(
      within(box).getByText('Shown once. The user must set a new password at first login.'),
    ).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/users')!;
    expect(post.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(post.body).toMatchObject({
      employee_id: 'new01',
      mobile: '9840000009',
      role_id: 'r-admin',
    });
    expect(JSON.stringify({ ...localStorage })).not.toContain('Temp-Pass-77');
    await user.click(within(box).getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Temp-Pass-77')).not.toBeInTheDocument();
  });

  it('shows API field errors on the form', async () => {
    const { user } = await openUsers((c) =>
      c.method === 'POST' && c.path === '/users'
        ? apiError(422, 'validation_error', 'Invalid.', [
            { field: 'employee_id', message: 'This employee ID already exists.' },
          ])
        : undefined,
    );
    await user.click(screen.getByRole('button', { name: '+ Add user' }));
    await user.type(screen.getByLabelText(/Employee ID/), 'ICN001');
    await user.type(screen.getByLabelText(/Full name/), 'X Y');
    await user.type(screen.getByLabelText(/Designation/), 'Nurse');
    await user.type(screen.getByLabelText(/Mobile/), '9840000009');
    await user.click(screen.getByRole('button', { name: 'Create user and login' }));
    expect(await screen.findByText('This employee ID already exists.')).toBeInTheDocument();
  });

  it('edits a user with the employee ID read-only', async () => {
    const { calls, user } = await openUsers((c) =>
      c.method === 'PATCH' ? { body: makeUser({ full_name: 'Renamed' }) } : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Edit Test ICN' }));
    expect(screen.getByLabelText(/Employee ID/)).toHaveAttribute('readonly');
    const name = screen.getByLabelText(/Full name/);
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toBe('/users/u1');
    expect(patch.body).toMatchObject({ full_name: 'Renamed' });
    expect(patch.body).not.toHaveProperty('employee_id');
  });

  it('resets a password and shows it once; only for active users', async () => {
    const { user } = await openUsers((c) =>
      c.path === '/users/u1/reset-password'
        ? { body: { user: makeUser(), temporary_password: 'Reset-Pass-5' } }
        : undefined,
    );
    expect(
      screen.queryByRole('button', { name: 'Reset password for Dr. Arun K.' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset password for Test ICN' }));
    expect(await screen.findByText('Reset-Pass-5')).toBeInTheDocument();
  });

  it('requires a reason before changing status', async () => {
    const { calls, user } = await openUsers((c) =>
      c.path === '/users/u1/status' ? { body: makeUser({ status: 'Inactive' }) } : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Make inactive: Test ICN' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Enter a reason.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/users/u1/status')).toBe(false);
    await user.type(screen.getByLabelText('Reason (required)'), 'Left the hospital');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/users/u1/status')).toBe(true));
    expect(calls.find((c) => c.path === '/users/u1/status')!.body).toEqual({
      status: 'Inactive',
      reason: 'Left the hospital',
    });
  });

  it('shows the 409 last-admin message clearly', async () => {
    const msg = 'Cannot deactivate the last active admin.';
    const { user } = await openUsers((c) =>
      c.path === '/users/u1/status' ? apiError(409, 'conflict', msg) : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Make inactive: Test ICN' }));
    await user.type(screen.getByLabelText('Reason (required)'), 'test');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(msg)).toBeInTheDocument();
  });

  it('clears the secret box when leaving the page', async () => {
    const { user } = await openUsers((c) =>
      c.path === '/users/u1/reset-password'
        ? { body: { user: makeUser(), temporary_password: 'Reset-Pass-5' } }
        : undefined,
    );
    await user.click(screen.getByRole('button', { name: 'Reset password for Test ICN' }));
    await screen.findByText('Reset-Pass-5');
    await user.click(screen.getByRole('link', { name: 'Roles & permissions' }));
    await user.click(screen.getByRole('link', { name: 'Users' }));
    await screen.findByText('ICN001');
    expect(screen.queryByText('Reset-Pass-5')).not.toBeInTheDocument();
  });

  it('copies via the clipboard', async () => {
    const { user } = await openUsers((c) =>
      c.path === '/users/u1/reset-password'
        ? { body: { user: makeUser(), temporary_password: 'Reset-Pass-5' } }
        : undefined,
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Reset password for Test ICN' }));
    await user.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Username: ICN001  Temporary password: Reset-Pass-5');
  });
});
