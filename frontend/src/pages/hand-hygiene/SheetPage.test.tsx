import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../app/App';
import { CAT_DOCTOR, CAT_NURSE, nurseMe, page } from '../../test/fixtures';
import { mockApi, renderWithAuth, withSession } from '../../test/utils';

describe('Printable sheet', () => {
  it('shows category codes and legend from the API, 12 rows, and prints', async () => {
    const { calls } = mockApi(
      withSession(nurseMe, (c) => {
        if (c.path === '/staff-categories') return { body: page([CAT_DOCTOR, CAT_NURSE]) };
      }),
    );
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderWithAuth(<AppRoutes />, '/hand-hygiene/sheet');
    expect(await screen.findByText(/D Doctor · N Nurse/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/staff-categories')!.query.get('status')).toBe('Active');
    const sheet = screen.getByRole('region', { name: 'Observation sheet' });
    expect(within(sheet).getByText(/SRI NARAYANI HOSPITAL/)).toBeInTheDocument();
    expect(within(sheet).getAllByRole('row')).toHaveLength(13);
    expect(within(sheet).getByText('D N')).toBeInTheDocument();
    expect(within(sheet).getByText(/Signature of observer/)).toBeInTheDocument();
    expect(screen.getByText(/server-generated PDF arrives in a later slice/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Print / Save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
  });
});
