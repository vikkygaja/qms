import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ImportReport } from '../../../api/types';
import { openAt } from '../../../test/masters';
import { apiError } from '../../../test/utils';

const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  dry_run: true,
  applied: false,
  summary: { created: 1, updated: 0, unchanged: 0, errors: 0 },
  rows: [{ sheet: 'Wards', row: 2, name: 'ICU 2', action: 'create', message: '' }],
  truncated: false,
  ...over,
});
const xlsx = () =>
  new File(['x'], 'masters.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
const csv = () => new File(['Name\nA'], 'wards.csv', { type: 'text/csv' });
const URL_ = '/admin/masters/import-export';

describe('Import & export page', () => {
  it('shows the three steps, the limits and the never-change-status sentence', async () => {
    await openAt(URL_);
    for (const h of ['Download', 'Upload and check', 'Review and apply'])
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    expect(
      screen.getByText(/never changes Active\/Inactive status and never deletes/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 MB and 5,000 rows/)).toBeInTheDocument();
  });

  it('points the download links at the export and template endpoints', async () => {
    await openAt(URL_);
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('Download all (Excel)')).toBe('/api/v1/masters/export?kind=all&format=xlsx');
    expect(href('Download template (Excel)')).toBe('/api/v1/masters/template?kind=all&format=xlsx');
    expect(href('Download Wards as Excel')).toBe('/api/v1/masters/export?kind=wards&format=xlsx');
    expect(href('Download Departments as CSV')).toBe(
      '/api/v1/masters/export?kind=departments&format=csv',
    );
    expect(href('Download Staff categories as Excel')).toBe(
      '/api/v1/masters/export?kind=staff-categories&format=xlsx',
    );
  });

  it('requires choosing a master for a CSV file', async () => {
    const { calls, user } = await openAt(URL_);
    await user.upload(screen.getByLabelText('File (.xlsx or .csv)'), csv());
    await user.click(screen.getByRole('button', { name: 'Check file' }));
    expect(
      await screen.findByText('Choose which master this CSV file contains.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/masters/import')).toBe(false);
    expect(screen.queryByRole('option', { name: /All masters/ })).not.toBeInTheDocument();
  });

  it('previews a dry run with errors first and disables Apply', async () => {
    const { calls, user } = await openAt(URL_, (c) =>
      c.path === '/masters/import'
        ? {
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
          }
        : undefined,
    );
    await user.upload(screen.getByLabelText('File (.xlsx or .csv)'), xlsx());
    await user.click(screen.getByRole('button', { name: 'Check file' }));
    expect(
      await screen.findByText(/1 created, 0 updated, 0 unchanged, 1 errors/),
    ).toBeInTheDocument();
    expect(screen.getByText(/only the first 500 rows/)).toBeInTheDocument();
    const preview = screen.getByRole('group', { name: 'Import preview' });
    expect(within(within(preview).getAllByRole('row')[1]).getByText('Bad')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
    const call = calls.find((c) => c.path === '/masters/import')!;
    expect(call.query.get('kind')).toBe('all');
    expect(call.query.get('dry_run')).toBe('true');
    expect(call.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect((call.body as FormData).get('file')).toBeInstanceOf(File);
    await user.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(screen.queryByRole('group', { name: 'Import preview' })).not.toBeInTheDocument();
  });

  it('applies a clean file with dry_run=false and toasts', async () => {
    const { calls, user } = await openAt(URL_, (c) =>
      c.path === '/masters/import'
        ? {
            body:
              c.query.get('dry_run') === 'true'
                ? report()
                : report({ dry_run: false, applied: true }),
          }
        : undefined,
    );
    await user.upload(screen.getByLabelText('File (.xlsx or .csv)'), csv());
    await user.selectOptions(screen.getByLabelText('Master in this file'), 'wards');
    await user.click(screen.getByRole('button', { name: 'Check file' }));
    const apply = await screen.findByRole('button', { name: 'Apply import' });
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(
      await screen.findByText('Import applied: 1 created, 0 updated, 0 unchanged.'),
    ).toBeInTheDocument();
    const imports = calls.filter((c) => c.path === '/masters/import');
    expect(imports.map((c) => c.query.get('dry_run'))).toEqual(['true', 'false']);
    expect(imports[1].query.get('kind')).toBe('wards');
    expect(imports[1].headers.get('X-CSRF-Token')).toBe('csrf-1');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Import preview' })).not.toBeInTheDocument(),
    );
  });

  it('shows server errors for a rejected file', async () => {
    const { user } = await openAt(URL_, (c) =>
      c.path === '/masters/import'
        ? apiError(413, 'payload_too_large', 'File is too large.')
        : undefined,
    );
    fireEvent.change(screen.getByLabelText('File (.xlsx or .csv)'), {
      target: { files: [xlsx()] },
    });
    await user.click(screen.getByRole('button', { name: 'Check file' }));
    expect(await screen.findByText('File is too large.')).toBeInTheDocument();
  });
});
