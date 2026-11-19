import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../../app/App';
import { adminMe, makeAudit, page } from '../../test/fixtures';
import { mockApi, renderWithAuth, withSession } from '../../test/utils';

describe('Audit log page', () => {
  it('shows entries in IST and applies filters and pagination', async () => {
    const { calls } = mockApi(
      withSession(adminMe, (c) =>
        c.path === '/audit-log'
          ? { body: { ...page([makeAudit()], { total: 60 }), page_size: 25 } }
          : undefined,
      ),
    );
    renderWithAuth(<AppRoutes />, '/admin/audit-log');
    expect(await screen.findByText('Created user Test ICN (ICN001) as ICN')).toBeInTheDocument();
    expect(screen.getByText(/19 Nov 2026, 3:30/)).toBeInTheDocument();
    expect(screen.getByText('Test Admin (ADMIN)')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3 · 60 records')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Entity'), 'user');
    await user.selectOptions(screen.getByLabelText('Action'), 'status_change');
    await user.type(screen.getByLabelText('Search text'), 'arun');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.path === '/audit-log')!;
      expect(last.query.get('entity')).toBe('user');
      expect(last.query.get('action')).toBe('status_change');
      expect(last.query.get('q')).toBe('arun');
    });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.path === '/audit-log')!;
      expect(last.query.get('page')).toBe('2');
    });
  });
});
