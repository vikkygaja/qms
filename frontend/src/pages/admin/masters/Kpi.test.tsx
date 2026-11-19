import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { openAt } from '../../../test/masters';
import { apiError } from '../../../test/utils';

describe('KPI thresholds page', () => {
  it('loads values and draws the preview bands', async () => {
    await openAt('/admin/masters/kpi');
    expect(await screen.findByLabelText('Green from (%)')).toHaveValue(90);
    expect(screen.getByLabelText('Amber from (%)')).toHaveValue(80);
    expect(
      screen.getByRole('img', {
        name: 'Red 0 to 79 percent, amber 80 to 89 percent, green 90 to 100 percent',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Green: 90% to 100%')).toBeInTheDocument();
    expect(screen.getByText(/Compliance at or above green is shown green/)).toBeInTheDocument();
  });

  it('updates the preview live and hides it for invalid values', async () => {
    const { user } = await openAt('/admin/masters/kpi');
    const amber = await screen.findByLabelText('Amber from (%)');
    await waitFor(() => expect(amber).toHaveValue(80));
    await user.clear(amber);
    await user.type(amber, '70');
    expect(screen.getByText('Amber: 70% to 89%')).toBeInTheDocument();
    await user.clear(amber);
    await user.type(amber, '95');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('rejects amber >= green and out-of-range days without calling the server', async () => {
    const { calls, user } = await openAt('/admin/masters/kpi');
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
    const { calls, user } = await openAt('/admin/masters/kpi', (c) => {
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
