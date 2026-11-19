import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../../app/App';
import { adminMe, PERMISSIONS, ROLES } from '../../test/fixtures';
import { apiError, mockApi, renderWithAuth, withSession, type ApiHandler } from '../../test/utils';

async function openRoles(extra: ApiHandler = () => undefined) {
  const m = mockApi(
    withSession(adminMe, (c) => {
      if (c.path === '/permissions') return { body: PERMISSIONS };
      if (c.method === 'GET' && c.path === '/roles') return { body: ROLES };
      return extra(c);
    }),
  );
  renderWithAuth(<AppRoutes />, '/admin/roles');
  await screen.findByText('Manage masters');
  return { ...m, user: userEvent.setup() };
}

describe('Roles page', () => {
  it('shows roles as columns with user counts', async () => {
    await openRoles();
    expect(screen.getByText('1 users')).toBeInTheDocument();
    expect(screen.getByText('2 users')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'ICN: Manage link nurses' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ICN: Manage masters' })).not.toBeChecked();
  });

  it('disables the users checkbox for admin with an explanatory title', async () => {
    await openRoles();
    const box = screen.getByRole('checkbox', { name: 'Admin: Manage users and roles' });
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute('title', 'Admin always keeps this');
    expect(screen.getByRole('checkbox', { name: 'ICN: Manage users and roles' })).toBeEnabled();
  });

  it('saves a change immediately and shows a toast', async () => {
    const { calls, user } = await openRoles((c) =>
      c.method === 'PUT'
        ? { body: { ...ROLES[1], permissions: ['ln', 'record', 'dash', 'masters'] } }
        : undefined,
    );
    await user.click(screen.getByRole('checkbox', { name: 'ICN: Manage masters' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/roles/r-icn/permissions');
    expect(put.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(put.body).toEqual({ permissions: ['masters', 'ln', 'record', 'dash'] });
    expect(await screen.findByText(/Saved: ICN/)).toBeInTheDocument();
  });

  it('shows a 409 message when a change is refused', async () => {
    const { user } = await openRoles((c) =>
      c.method === 'PUT' ? apiError(409, 'conflict', 'Admin must keep users.') : undefined,
    );
    await user.click(screen.getByRole('checkbox', { name: 'ICN: Manage masters' }));
    expect(await screen.findByText('Admin must keep users.')).toBeInTheDocument();
  });

  it('adds a role and requires a name', async () => {
    const { calls, user } = await openRoles((c) =>
      c.method === 'POST' && c.path === '/roles'
        ? {
            status: 201,
            body: { ...ROLES[1], id: 'r-new', key: 'r_ns', name: 'Nursing Superintendent' },
          }
        : undefined,
    );
    await user.click(screen.getByRole('button', { name: '+ Add role' }));
    expect(await screen.findByText('Enter a role name.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('New role name'), 'Nursing Superintendent');
    await user.click(screen.getByRole('button', { name: '+ Add role' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Nursing Superintendent',
    });
    expect(await screen.findByText(/Role "Nursing Superintendent" added/)).toBeInTheDocument();
  });
});
