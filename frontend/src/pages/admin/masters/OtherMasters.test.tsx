import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEPT_ICU } from '../../../test/fixtures';
import { openAt } from '../../../test/masters';
import { apiError } from '../../../test/utils';

describe('Departments page', () => {
  it('lists departments with a link to their wards and sorts server-side', async () => {
    const { calls, user } = await openAt('/admin/masters/departments', undefined, 'Critical Care');
    const link = screen.getByRole('link', { name: 'View 1 ward in Critical Care' });
    expect(link).toHaveAttribute('href', '/admin/masters/wards?department_id=d1');
    expect(screen.getByText('General Medicine')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Wards' }));
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.path === '/departments')!;
      expect(last.query.get('sort')).toBe('ward_count');
    });
  });

  it('shows the server 409 in the drawer', async () => {
    const { user } = await openAt(
      '/admin/masters/departments',
      (c) =>
        c.method === 'POST' && c.path === '/departments'
          ? apiError(409, 'conflict', 'That name already exists.')
          : undefined,
      'Critical Care',
    );
    await user.click(screen.getByRole('button', { name: 'Add department' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add department' });
    await user.type(within(dlg).getByLabelText('Department name'), 'Critical Care');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('That name already exists.')).toBeInTheDocument();
  });

  it('activates an inactive department through the dialog', async () => {
    const { calls, user } = await openAt(
      '/admin/masters/departments?status=inactive',
      (c) => {
        if (c.method === 'GET' && c.path === '/departments')
          return {
            body: {
              items: [{ ...DEPT_ICU, status: 'Inactive' }],
              total: 1,
              page: 1,
              page_size: 50,
            },
          };
        if (c.method === 'POST' && c.path === '/departments/d1/status') return { body: DEPT_ICU };
      },
      'Critical Care',
    );
    await user.click(screen.getByRole('button', { name: 'Make active: Critical Care' }));
    const dlg = await screen.findByRole('dialog', { name: 'Make Critical Care active?' });
    await user.type(within(dlg).getByLabelText(/Reason/), 'Reopened');
    await user.click(within(dlg).getByRole('button', { name: 'Make active' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
        status: 'Active',
        reason: 'Reopened',
      }),
    );
  });
});

describe('Staff categories page', () => {
  it('shows the code chip and explains where the code appears', async () => {
    await openAt('/admin/masters/staff-categories', undefined, 'Doctor');
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText(/code appears on the printable observation sheet/)).toBeInTheDocument();
  });

  it('validates the code in the drawer', async () => {
    const { user } = await openAt('/admin/masters/staff-categories', undefined, 'Doctor');
    await user.click(screen.getByRole('button', { name: 'Add staff category' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add staff category' });
    await user.type(within(dlg).getByLabelText('Category name'), 'Intern');
    await user.type(within(dlg).getByLabelText(/^Code/), 'AB-1');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('Enter 1 to 3 letters or digits.')).toBeInTheDocument();
  });
});
