import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './App';
import { renderWithProviders, stubHealth } from '../test/utils';

const nav = () => screen.getByRole('navigation', { name: /main/i });

describe('App shell', () => {
  it('renders the menu groups from the approved prototype', () => {
    stubHealth(true);
    renderWithProviders(<AppRoutes />);
    const n = within(nav());
    for (const g of ['Hand Hygiene', 'Other modules', 'Platform']) {
      expect(n.getByText(g)).toBeInTheDocument();
    }
    for (const l of [
      'Home',
      'New session',
      'Sessions',
      'Dashboard',
      'Ward targets',
      'Link nurses',
      'Printable sheet',
      'Reports centre',
      'Users',
      'Roles & permissions',
      'Masters',
    ]) {
      expect(n.getByRole('link', { name: l })).toBeInTheDocument();
    }
  });

  it('shows other modules as Coming soon and not clickable', () => {
    stubHealth(true);
    renderWithProviders(<AppRoutes />);
    const n = within(nav());
    for (const m of [
      'NABH Readiness',
      'Audits & Checklists',
      'CAPA',
      'MRD Deficiency',
      'Incidents',
      'Documents',
    ]) {
      expect(n.queryByRole('link', { name: new RegExp(m) })).not.toBeInTheDocument();
      expect(n.getByText(m).closest('[aria-disabled="true"]')).not.toBeNull();
    }
    expect(n.getAllByText('Soon')).toHaveLength(6);
  });

  it('marks the current page and navigates between placeholder pages', async () => {
    stubHealth(true);
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />);
    expect(within(nav()).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(within(nav()).getByRole('link', { name: 'Sessions' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Sessions' })).toBeInTheDocument();
    expect(within(nav()).getByRole('link', { name: 'Sessions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('is keyboard reachable: Tab lands on the first menu link', async () => {
    stubHealth(true);
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />);
    await user.tab();
    // first focusable element is the skip link, then the first nav link
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveFocus();
    await user.tab();
    expect(within(nav()).getByRole('link', { name: 'Home' })).toHaveFocus();
  });

  it('shows the API health badge in the top bar', async () => {
    stubHealth(true);
    renderWithProviders(<AppRoutes />);
    expect(await screen.findByText(/API online/i)).toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', () => {
    stubHealth(true);
    renderWithProviders(<AppRoutes />, '/does-not-exist');
    expect(screen.getByRole('heading', { level: 1, name: /page not found/i })).toBeInTheDocument();
  });
});
