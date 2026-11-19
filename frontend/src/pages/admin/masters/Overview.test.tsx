import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { icnMe } from '../../../test/fixtures';
import { openAt } from '../../../test/masters';
import { apiError, mockApi, renderWithAuth, withSession } from '../../../test/utils';
import { AppRoutes } from '../../../app/App';

describe('Masters overview', () => {
  it('shows No access without the masters permission on every route', async () => {
    for (const r of ['/admin/masters', '/admin/masters/wards', '/admin/masters/import-export']) {
      mockApi(withSession(icnMe));
      const { unmount } = renderWithAuth(<AppRoutes />, r);
      expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
      unmount();
    }
  });

  it('renders one card per master with headline numbers and links', async () => {
    await openAt('/admin/masters', undefined, 'Monthly target total 1,000 opportunities');
    const main = within(screen.getByRole('main'));
    const wards = main.getByRole('link', { name: 'Wards' }).closest('article')!;
    expect(within(wards).getByText('20')).toBeInTheDocument();
    expect(within(wards).getByText(/active wards · 2 inactive/)).toBeInTheDocument();
    expect(main.getByText(/Green ≥ 90% · Amber ≥ 80%/)).toBeInTheDocument();
    expect(main.getByText('No entry alert after 10 days')).toBeInTheDocument();
    expect(main.getByText(/Where observations are recorded/)).toBeInTheDocument();
    const href = (n: string) => main.getByRole('link', { name: n }).getAttribute('href');
    expect(href('Departments')).toBe('/admin/masters/departments');
    expect(href('Staff categories')).toBe('/admin/masters/staff-categories');
    expect(href('KPI thresholds')).toBe('/admin/masters/kpi');
    expect(href('Import & export')).toBe('/admin/masters/import-export');
  });

  it('shows a loading state and then an error with retry', async () => {
    await openAt('/admin/masters', (c) =>
      c.path === '/masters/summary' ? apiError(500, 'server_error', 'Summary failed.') : undefined,
    );
    expect(await screen.findByText('Summary failed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('menu links route to each master page', async () => {
    const { user } = await openAt(
      '/admin/masters',
      undefined,
      'Monthly target total 1,000 opportunities',
    );
    const nav = within(screen.getByRole('navigation', { name: /main/i }));
    await user.click(nav.getByRole('link', { name: 'Wards' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Wards' })).toBeInTheDocument();
    await user.click(nav.getByRole('link', { name: 'KPI thresholds' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'KPI thresholds' }),
    ).toBeInTheDocument();
    await user.click(nav.getByRole('link', { name: 'Import & export' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Import & export' }),
    ).toBeInTheDocument();
  });
});
