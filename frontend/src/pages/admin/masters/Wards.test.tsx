import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { page, WARD_MICU } from '../../../test/fixtures';
import { openAt } from '../../../test/masters';
import { apiError, type ApiCall } from '../../../test/utils';

const lastWards = (calls: ApiCall[]) => [...calls].reverse().find((c) => c.path === '/wards')!;

describe('Wards page', () => {
  it('lists active wards by default with count, table and footer text', async () => {
    const { calls } = await openAt('/admin/masters/wards', undefined, 'MICU');
    const q = lastWards(calls).query;
    expect(q.get('status')).toBe('Active');
    expect(q.get('page_size')).toBe('50');
    expect(screen.getByRole('heading', { level: 1, name: 'Wards' })).toBeInTheDocument();
    expect(screen.getByText('1 ward')).toBeInTheDocument();
    expect(screen.getByText('Showing 1-1 of 1')).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Critical Care')).toBeInTheDocument();
    expect(table.getByText('65')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add ward' })).toBeInTheDocument();
    expect(await screen.findByText('Monthly target (active wards)')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Masters' })).toHaveAttribute('href', '/admin/masters');
  });

  it('restores filters, sort and page from the URL and sends them to the API', async () => {
    const { calls } = await openAt(
      '/admin/masters/wards?q=mic&status=inactive&department_id=d1&sort=monthly_target&order=desc&page=2&page_size=25',
      (c) =>
        c.path === '/wards' ? { body: { ...page([WARD_MICU]), total: 60, page: 2 } } : undefined,
      'MICU',
    );
    const q = lastWards(calls).query;
    expect(Object.fromEntries(q)).toEqual({
      q: 'mic',
      status: 'Inactive',
      department_id: 'd1',
      sort: 'monthly_target',
      order: 'desc',
      page: '2',
      page_size: '25',
    });
    expect(screen.getByLabelText('Search wards')).toHaveValue('mic');
    expect(screen.getByLabelText('Status')).toHaveValue('inactive');
    expect(screen.getByLabelText('Rows per page')).toHaveValue('25');
    expect(await screen.findByLabelText('Department')).toHaveValue('d1');
    expect(screen.getByText('Showing 26-50 of 60')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Monthly target/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('offers all departments (active and inactive) in the filter and applies filters', async () => {
    const { calls, user } = await openAt('/admin/masters/wards', undefined, 'MICU');
    const deptCall = calls.find((c) => c.path === '/departments')!;
    expect(deptCall.query.has('status')).toBe(false);
    await user.selectOptions(await screen.findByLabelText('Department'), 'd1');
    await waitFor(() => expect(lastWards(calls).query.get('department_id')).toBe('d1'));
    await user.selectOptions(screen.getByLabelText('Status'), 'All');
    await waitFor(() => expect(lastWards(calls).query.has('status')).toBe(false));
    await user.selectOptions(screen.getByLabelText('Rows per page'), '100');
    await waitFor(() => expect(lastWards(calls).query.get('page_size')).toBe('100'));
    await user.type(screen.getByLabelText('Search wards'), 'mic');
    await waitFor(() => expect(lastWards(calls).query.get('q')).toBe('mic'));
  });

  it('sorts server-side when a header is clicked and toggles the direction', async () => {
    const { calls, user } = await openAt('/admin/masters/wards', undefined, 'MICU');
    expect(screen.getByRole('columnheader', { name: /Ward/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await user.click(screen.getByRole('button', { name: 'Monthly target' }));
    await waitFor(() => {
      const q = lastWards(calls).query;
      expect(q.get('sort')).toBe('monthly_target');
      expect(q.get('order')).toBe('asc');
    });
    await user.click(screen.getByRole('button', { name: 'Monthly target' }));
    await waitFor(() => expect(lastWards(calls).query.get('order')).toBe('desc'));
    expect(screen.getByRole('columnheader', { name: /Monthly target/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('shows the no-match empty state and clears filters', async () => {
    const { calls, user } = await openAt(
      '/admin/masters/wards?q=zzz',
      (c) => (c.path === '/wards' && c.query.get('q') ? { body: page([]) } : undefined),
      'No wards match these filters',
    );
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByText('MICU')).toBeInTheDocument();
    expect(lastWards(calls).query.has('q')).toBe(false);
    expect(screen.getByLabelText('Search wards')).toHaveValue('');
  });

  it('shows a first-time empty state with an add call to action', async () => {
    const { user } = await openAt(
      '/admin/masters/wards',
      (c) => (c.path === '/wards' ? { body: page([]) } : undefined),
      'No wards yet',
    );
    await user.click(screen.getByRole('button', { name: 'Add the first ward' }));
    expect(await screen.findByRole('dialog', { name: 'Add ward' })).toBeInTheDocument();
  });

  it('shows an error with retry when the list fails', async () => {
    await openAt('/admin/masters/wards', (c) =>
      c.path === '/wards' ? apiError(500, 'server_error', 'Boom.') : undefined,
    );
    expect(await screen.findByText('Boom.')).toBeInTheDocument();
  });

  it('validates the add drawer before calling the server', async () => {
    const { calls, user } = await openAt('/admin/masters/wards', undefined, 'MICU');
    await user.click(screen.getByRole('button', { name: 'Add ward' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add ward' });
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(
      await within(dlg).findByText('Enter a name of 1 to 100 characters.'),
    ).toBeInTheDocument();
    expect(within(dlg).getByText('Choose a department.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('adds a ward from the drawer with the CSRF header, closes it and shows a toast', async () => {
    const { calls, user } = await openAt(
      '/admin/masters/wards',
      (c) =>
        c.method === 'POST' && c.path === '/wards' ? { status: 201, body: WARD_MICU } : undefined,
      'MICU',
    );
    await user.click(screen.getByRole('button', { name: 'Add ward' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add ward' });
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/departments' && c.query.get('status') === 'Active'),
      ).toBe(true),
    );
    await user.type(within(dlg).getByLabelText('Ward name'), 'ICU 2');
    await user.selectOptions(await within(dlg).findByLabelText('Department'), 'd1');
    const target = within(dlg).getByLabelText(/Monthly target/);
    await user.clear(target);
    await user.type(target, '55');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ name: 'ICU 2', department_id: 'd1', monthly_target: 55 });
    expect(post.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(await screen.findByText('Added ICU 2.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a 409 conflict inside the drawer and keeps it open', async () => {
    const { user } = await openAt(
      '/admin/masters/wards',
      (c) =>
        c.method === 'POST' && c.path === '/wards'
          ? apiError(409, 'conflict', 'That name already exists.')
          : undefined,
      'MICU',
    );
    await user.click(screen.getByRole('button', { name: 'Add ward' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add ward' });
    await user.type(within(dlg).getByLabelText('Ward name'), 'MICU');
    await user.selectOptions(await within(dlg).findByLabelText('Department'), 'd1');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('That name already exists.')).toBeInTheDocument();
  });

  it('closes the drawer with Escape', async () => {
    const { user } = await openAt('/admin/masters/wards', undefined, 'MICU');
    await user.click(screen.getByRole('button', { name: 'Edit MICU' }));
    expect(await screen.findByRole('dialog', { name: 'Edit ward' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('edits a ward with PATCH', async () => {
    const { calls, user } = await openAt(
      '/admin/masters/wards',
      (c) => (c.method === 'PATCH' && c.path === '/wards/w1' ? { body: WARD_MICU } : undefined),
      'MICU',
    );
    await user.click(screen.getByRole('button', { name: 'Edit MICU' }));
    const dlg = await screen.findByRole('dialog', { name: 'Edit ward' });
    const target = within(dlg).getByLabelText(/Monthly target/);
    expect(target).toHaveValue(65);
    await user.clear(target);
    await user.type(target, '70');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ name: 'MICU', department_id: 'd1', monthly_target: 70 });
    expect(patch.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(await screen.findByText('Saved MICU.')).toBeInTheDocument();
  });

  it('requires a reason in the status dialog, then posts it', async () => {
    const { calls, user } = await openAt(
      '/admin/masters/wards',
      (c) =>
        c.method === 'POST' && c.path === '/wards/w1/status'
          ? { body: { ...WARD_MICU, status: 'Inactive' } }
          : undefined,
      'MICU',
    );
    await user.click(screen.getByRole('button', { name: 'Make inactive: MICU' }));
    const dlg = await screen.findByRole('dialog', { name: 'Make MICU inactive?' });
    expect(within(dlg).getByText(/no longer appear on entry screens/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Make inactive' }));
    expect(await within(dlg).findByText('Enter a reason.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await user.type(within(dlg).getByLabelText(/Reason/), 'Ward closed');
    await user.click(within(dlg).getByRole('button', { name: 'Make inactive' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ status: 'Inactive', reason: 'Ward closed' });
    expect(post.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(await screen.findByText('MICU is now Inactive.')).toBeInTheDocument();
  });
});
