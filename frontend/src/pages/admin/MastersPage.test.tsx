import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../../app/App';
import type { ImportReport } from '../../api/types';
import {
  adminMe,
  CAT_DOCTOR,
  DEPT_GEN,
  DEPT_ICU,
  icnMe,
  page,
  WARD_MICU,
} from '../../test/fixtures';
import { apiError, mockApi, renderWithAuth, withSession, type ApiHandler } from '../../test/utils';

const base = (extra: ApiHandler = () => undefined): ApiHandler =>
  withSession(adminMe, (c) => {
    const r = extra(c);
    if (r) return r;
    if (c.method === 'GET' && c.path === '/wards') return { body: page([WARD_MICU]) };
    if (c.method === 'GET' && c.path === '/departments')
      return { body: page([DEPT_ICU, DEPT_GEN]) };
    if (c.method === 'GET' && c.path === '/staff-categories') return { body: page([CAT_DOCTOR]) };
    if (c.method === 'GET' && c.path === '/settings/kpi')
      return { body: { green: 90, amber: 80, inactive_days: 10 } };
    return undefined;
  });

async function openMasters(extra?: ApiHandler) {
  const m = mockApi(base(extra));
  renderWithAuth(<AppRoutes />, '/admin/masters');
  await screen.findByText('MICU');
  return { ...m, user: userEvent.setup() };
}

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  dry_run: true,
  applied: false,
  summary: { created: 1, updated: 0, unchanged: 0, errors: 0 },
  rows: [{ sheet: 'Wards', row: 2, name: 'ICU 2', action: 'create', message: '' }],
  truncated: false,
  ...over,
});

describe('Masters page: access and lists', () => {
  it('shows No access without the masters permission', async () => {
    mockApi(withSession(icnMe));
    renderWithAuth(<AppRoutes />, '/admin/masters');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });

  it('renders the four cards with data', async () => {
    await openMasters();
    const wards = screen.getByRole('region', { name: 'Wards' });
    expect(within(wards).getByText('Critical Care')).toBeInTheDocument();
    expect(within(wards).getByText('65')).toBeInTheDocument();
    const depts = screen.getByRole('region', { name: 'Departments' });
    expect(within(depts).getByText('General Medicine')).toBeInTheDocument();
    const cats = screen.getByRole('region', { name: 'Staff categories (observed)' });
    expect(within(cats).getByText('Doctor')).toBeInTheDocument();
    expect(within(cats).getByText('D')).toBeInTheDocument();
    expect(await screen.findByLabelText('Green from (%)')).toHaveValue(90);
  });

  it('lists Active by default and sends status and search filters', async () => {
    const { calls, user } = await openMasters();
    expect(calls.find((c) => c.path === '/wards')!.query.get('status')).toBe('Active');
    await user.selectOptions(screen.getByLabelText('Show wards'), 'Inactive');
    await user.type(screen.getByLabelText('Search wards'), 'mic');
    await user.click(screen.getByRole('button', { name: 'Run search in wards' }));
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.path === '/wards')!;
      expect(last.query.get('status')).toBe('Inactive');
      expect(last.query.get('q')).toBe('mic');
    });
    await user.selectOptions(screen.getByLabelText('Show wards'), 'All');
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.path === '/wards')!;
      expect(last.query.has('status')).toBe(false);
    });
  });
});

describe('Masters page: add, edit, status', () => {
  it('validates the ward form before calling the server', async () => {
    const { calls, user } = await openMasters();
    await user.click(screen.getByRole('button', { name: 'Add ward' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a name of 1 to 100 characters.')).toBeInTheDocument();
    expect(screen.getByText('Choose a department.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('adds a ward with CSRF header, lists only active departments, and shows a toast', async () => {
    const { calls, user } = await openMasters((c) => {
      if (c.method === 'POST' && c.path === '/wards') return { status: 201, body: WARD_MICU };
    });
    await user.click(screen.getByRole('button', { name: 'Add ward' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/departments' && c.query.get('status') === 'Active'),
      ).toBe(true),
    );
    await user.type(screen.getByLabelText('Ward name'), 'ICU 2');
    await user.selectOptions(await screen.findByLabelText('Department'), 'd1');
    const target = screen.getByLabelText('HH target (per month)');
    await user.clear(target);
    await user.type(target, '55');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ name: 'ICU 2', department_id: 'd1', monthly_target: 55 });
    expect(post.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(await screen.findByText('Added ICU 2.')).toBeInTheDocument();
  });

  it('shows the server 409 next to the form', async () => {
    const { user } = await openMasters((c) => {
      if (c.method === 'POST' && c.path === '/departments')
        return apiError(409, 'conflict', 'That name already exists.');
    });
    await user.click(screen.getByRole('button', { name: 'Add department' }));
    await user.type(screen.getByLabelText('Department name'), 'Critical Care');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That name already exists.')).toBeInTheDocument();
  });

  it('validates the category code', async () => {
    const { user } = await openMasters();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await user.type(screen.getByLabelText('Category name'), 'Intern');
    await user.type(screen.getByLabelText(/^Code/), 'AB-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter 1 to 3 letters or digits.')).toBeInTheDocument();
  });

  it('edits a ward with PATCH', async () => {
    const { calls, user } = await openMasters((c) => {
      if (c.method === 'PATCH' && c.path === '/wards/w1') return { body: WARD_MICU };
    });
    await user.click(screen.getByRole('button', { name: 'Edit MICU' }));
    const target = screen.getByLabelText('HH target (per month)');
    expect(target).toHaveValue(65);
    await user.clear(target);
    await user.type(target, '70');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ name: 'MICU', department_id: 'd1', monthly_target: 70 });
    expect(patch.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('requires a reason before changing status, then posts it', async () => {
    const { calls, user } = await openMasters((c) => {
      if (c.method === 'POST' && c.path === '/wards/w1/status')
        return { body: { ...WARD_MICU, status: 'Inactive' } };
    });
    await user.click(screen.getByRole('button', { name: 'Make inactive: MICU' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Enter a reason.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await user.type(screen.getByLabelText(/Reason/), 'Ward closed');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      status: 'Inactive',
      reason: 'Ward closed',
    });
    expect(await screen.findByText('MICU is now Inactive.')).toBeInTheDocument();
  });
});

describe('Masters page: KPI thresholds', () => {
  it('rejects amber >= green and out-of-range days without calling the server', async () => {
    const { calls, user } = await openMasters();
    const amber = await screen.findByLabelText('Amber from (%)');
    await waitFor(() => expect(amber).toHaveValue(80));
    await user.clear(amber);
    await user.type(amber, '95');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(await screen.findByText('Amber must be lower than green.')).toBeInTheDocument();
    await user.clear(amber);
    await user.type(amber, '70');
    const days = screen.getByLabelText('Inactive after (days)');
    await user.clear(days);
    await user.type(days, '400');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(await screen.findByText('Enter a whole number from 1 to 365.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('saves with PUT and CSRF, and shows server field errors', async () => {
    let fail = true;
    const { calls, user } = await openMasters((c) => {
      if (c.method === 'PUT' && c.path === '/settings/kpi') {
        if (fail)
          return apiError(422, 'validation_error', 'Invalid.', [
            { field: 'green', message: 'Server says green is wrong.' },
          ]);
        return { body: c.body };
      }
    });
    const amber = await screen.findByLabelText('Amber from (%)');
    await waitFor(() => expect(amber).toHaveValue(80));
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(await screen.findByText('Server says green is wrong.')).toBeInTheDocument();
    fail = false;
    await user.clear(amber);
    await user.type(amber, '75');
    await user.click(screen.getByRole('button', { name: 'Save thresholds' }));
    expect(await screen.findByText('KPI thresholds saved.')).toBeInTheDocument();
    const put = calls.filter((c) => c.method === 'PUT').pop()!;
    expect(put.body).toEqual({ green: 90, amber: 75, inactive_days: 10 });
    expect(put.headers.get('X-CSRF-Token')).toBe('csrf-1');
  });
});

describe('Masters page: downloads', () => {
  it('points the download links at the export and template endpoints', async () => {
    await openMasters();
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('Download all (Excel)')).toBe('/api/v1/masters/export?kind=all&format=xlsx');
    expect(href('Download template (Excel)')).toBe('/api/v1/masters/template?kind=all&format=xlsx');
    expect(href('Download Wards as Excel')).toBe('/api/v1/masters/export?kind=wards&format=xlsx');
    expect(href('Download Wards as CSV')).toBe('/api/v1/masters/export?kind=wards&format=csv');
    expect(href('Download Departments as CSV')).toBe(
      '/api/v1/masters/export?kind=departments&format=csv',
    );
    expect(href('Download Staff categories (observed) as Excel')).toBe(
      '/api/v1/masters/export?kind=staff-categories&format=xlsx',
    );
  });
});

describe('Masters page: import', () => {
  const xlsx = () =>
    new File(['x'], 'masters.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  const csv = () => new File(['Name\nA'], 'wards.csv', { type: 'text/csv' });

  it('explains that import never changes status or deletes', async () => {
    await openMasters();
    expect(
      screen.getByText(/never changes Active\/Inactive status and never deletes/),
    ).toBeInTheDocument();
  });

  it('requires choosing a master for a CSV file', async () => {
    const { calls, user } = await openMasters();
    await user.upload(screen.getByLabelText('File (.xlsx or .csv)'), csv());
    await user.click(screen.getByRole('button', { name: 'Check file' }));
    expect(
      await screen.findByText('Choose which master this CSV file contains.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/masters/import')).toBe(false);
    expect(screen.queryByRole('option', { name: /All masters/ })).not.toBeInTheDocument();
  });

  it('previews a dry run with errors first and disables Apply', async () => {
    const { calls, user } = await openMasters((c) => {
      if (c.path === '/masters/import')
        return {
          body: report({
            summary: { created: 1, updated: 0, unchanged: 0, errors: 1 },
            truncated: true,
            rows: [
              { sheet: 'Wards', row: 2, name: 'ICU 2', action: 'create', message: '' },
              {
                sheet: 'Wards',
                row: 7,
                name: 'Bad',
                action: 'error',
                message: "Department 'Critcal Care' does not exist",
              },
            ],
          }),
        };
    });
    await user.upload(screen.getByLabelText('File (.xlsx or .csv)'), xlsx());
    await user.click(screen.getByRole('button', { name: 'Check file' }));
    expect(
      await screen.findByText(/1 created, 0 updated, 0 unchanged, 1 errors/),
    ).toBeInTheDocument();
    expect(screen.getByText(/only the first 500 rows/)).toBeInTheDocument();
    const preview = screen.getByRole('group', { name: 'Import preview' });
    const rows = within(preview).getAllByRole('row');
    expect(within(rows[1]).getByText('Bad')).toBeInTheDocument(); // errors first
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
    const call = calls.find((c) => c.path === '/masters/import')!;
    expect(call.query.get('kind')).toBe('all');
    expect(call.query.get('dry_run')).toBe('true');
    expect(call.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(call.headers.has('Content-Type')).toBe(false);
    expect((call.body as FormData).get('file')).toBeInstanceOf(File);
    await user.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(screen.queryByRole('group', { name: 'Import preview' })).not.toBeInTheDocument();
  });

  it('applies a clean file with dry_run=false, refreshes the lists and toasts', async () => {
    let applied = false;
    const { calls, user } = await openMasters((c) => {
      if (c.path === '/masters/import')
        return {
          body:
            c.query.get('dry_run') === 'true'
              ? report()
              : report({ dry_run: false, applied: (applied = true) }),
        };
    });
    await user.upload(screen.getByLabelText('File (.xlsx or .csv)'), csv());
    await user.selectOptions(screen.getByLabelText('Master in this file'), 'wards');
    await user.click(screen.getByRole('button', { name: 'Check file' }));
    const apply = await screen.findByRole('button', { name: 'Apply import' });
    expect(apply).toBeEnabled();
    const before = calls.filter((c) => c.path === '/wards').length;
    await user.click(apply);
    expect(
      await screen.findByText('Import applied: 1 created, 0 updated, 0 unchanged.'),
    ).toBeInTheDocument();
    expect(applied).toBe(true);
    const imports = calls.filter((c) => c.path === '/masters/import');
    expect(imports.map((c) => c.query.get('dry_run'))).toEqual(['true', 'false']);
    expect(imports[1].query.get('kind')).toBe('wards');
    expect(imports[1].headers.get('X-CSRF-Token')).toBe('csrf-1');
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/wards').length).toBeGreaterThan(before),
    );
    expect(screen.queryByRole('group', { name: 'Import preview' })).not.toBeInTheDocument();
  });

  it('shows server errors for a rejected file', async () => {
    const { user } = await openMasters((c) => {
      if (c.path === '/masters/import')
        return apiError(413, 'payload_too_large', 'File is too large.');
    });
    fireEvent.change(screen.getByLabelText('File (.xlsx or .csv)'), {
      target: { files: [xlsx()] },
    });
    await user.click(screen.getByRole('button', { name: 'Check file' }));
    expect(await screen.findByText('File is too large.')).toBeInTheDocument();
  });
});
