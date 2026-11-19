import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../app/App';
import { adminMe } from '../test/fixtures';
import { apiError, mockApi, renderWithAuth, signedOut, withSession } from '../test/utils';

const fillLogin = async (id = 'ICN001', pw = 'wrong-pass') => {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Employee ID'), id);
  await user.type(screen.getByLabelText('Password'), pw);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return user;
};

describe('route guards', () => {
  it('sends a signed-out visitor to the login page', async () => {
    mockApi(signedOut());
    renderWithAuth(<AppRoutes />, '/admin/users');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the app when signed in and redirects /login to home', async () => {
    mockApi(withSession(adminMe));
    renderWithAuth(<AppRoutes />, '/login');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Quality overview' }),
    ).toBeInTheDocument();
  });

  it('forces the set-password page while must_change_password is true', async () => {
    mockApi(withSession({ ...adminMe, must_change_password: true }));
    renderWithAuth(<AppRoutes />, '/admin/users');
    expect(
      await screen.findByRole('heading', { name: 'Set your new password' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /main/i })).not.toBeInTheDocument();
  });

  it('keeps /set-password closed to people who do not need it', async () => {
    mockApi(withSession(adminMe));
    renderWithAuth(<AppRoutes />, '/set-password');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Quality overview' }),
    ).toBeInTheDocument();
  });

  it('blocks a page the role does not have', async () => {
    mockApi(withSession({ ...adminMe, permissions: ['dash'] }));
    renderWithAuth(<AppRoutes />, '/admin/users');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });
});

describe('login', () => {
  it('signs in and reaches home', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === '/auth/me') return apiError(401, 'unauthenticated', 'Sign in required.');
      if (c.path === '/auth/login') return { body: { user: adminMe, csrf_token: 'csrf-9' } };
    });
    renderWithAuth(<AppRoutes />, '/');
    await fillLogin('admin', 'Right-pass1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Quality overview' }),
    ).toBeInTheDocument();
    const call = calls.find((c) => c.path === '/auth/login')!;
    expect(call.body).toEqual({ employee_id: 'admin', password: 'Right-pass1' });
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it.each([
    [401, 'unauthenticated', 'Employee ID or password is incorrect.'],
    [403, 'inactive_account', 'This account is inactive. Contact the ICN or IT.'],
    [423, 'locked', 'Too many failed attempts. Try again in 15 minutes.'],
  ])('shows the API message verbatim for %i %s', async (status, code, message) => {
    mockApi((c) => {
      if (c.path === '/auth/me') return apiError(401, 'unauthenticated', 'Sign in required.');
      if (c.path === '/auth/login') return apiError(status, code, message);
    });
    renderWithAuth(<AppRoutes />, '/login');
    await fillLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('signs out and returns to the login page', async () => {
    const { calls } = mockApi(
      withSession(adminMe, (c) => (c.path === '/auth/logout' ? { status: 204 } : undefined)),
    );
    renderWithAuth(<AppRoutes />, '/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    const logout = calls.find((c) => c.path === '/auth/logout')!;
    expect(logout.headers.get('X-CSRF-Token')).toBe('csrf-1');
  });
});

describe('forced password change', () => {
  const must = { ...adminMe, must_change_password: true };
  const fill = async (cur: string, a: string, b: string) => {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Temporary password'), cur);
    await user.type(screen.getByLabelText('New password'), a);
    await user.type(screen.getByLabelText('Confirm new password'), b);
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
  };

  it('shows the rule text and validates before calling the server', async () => {
    const { calls } = mockApi(withSession(must));
    renderWithAuth(<AppRoutes />, '/');
    expect(
      await screen.findByText('At least 8 characters, with letters and numbers.'),
    ).toBeInTheDocument();
    await fill('Temp-1234', 'short', 'short');
    expect(
      await screen.findByText('Use at least 8 characters with letters and numbers.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/change-password')).toBe(false);
  });

  it('rejects a confirmation that does not match', async () => {
    mockApi(withSession(must));
    renderWithAuth(<AppRoutes />, '/');
    await fill('Temp-1234', 'Newpass123', 'Newpass124');
    expect(await screen.findByText("The two passwords don't match.")).toBeInTheDocument();
  });

  it('shows server errors', async () => {
    mockApi(
      withSession(must, (c) =>
        c.path === '/auth/change-password'
          ? apiError(422, 'validation_error', 'Invalid.', [
              { field: 'current_password', message: 'Current password is incorrect.' },
            ])
          : undefined,
      ),
    );
    renderWithAuth(<AppRoutes />, '/');
    await fill('Wrong-1234', 'Newpass123', 'Newpass123');
    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  });

  it('saves with the CSRF header and then opens the app', async () => {
    const { calls } = mockApi((c) => {
      if (c.path === '/auth/me') return { body: { user: must, csrf_token: 'csrf-1' } };
      if (c.path === '/auth/change-password')
        return { body: { user: adminMe, csrf_token: 'csrf-2' } };
    });
    renderWithAuth(<AppRoutes />, '/');
    await fill('Temp-1234', 'Newpass123', 'Newpass123');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Quality overview' }),
      ).toBeInTheDocument(),
    );
    const call = calls.find((c) => c.path === '/auth/change-password')!;
    expect(call.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(call.body).toEqual({ current_password: 'Temp-1234', new_password: 'Newpass123' });
  });
});
