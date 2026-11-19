import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './App';
import { adminMe, icnMe, nurseMe } from '../test/fixtures';
import { mockApi, renderWithAuth, withSession } from '../test/utils';
import type { Me } from '../api/types';

const nav = () => screen.getByRole('navigation', { name: /main/i });
async function open(me: Me = adminMe, route = '/') {
  mockApi(withSession(me));
  renderWithAuth(<AppRoutes />, route);
  await screen.findByRole('navigation', { name: /main/i });
}

describe('App shell', () => {
  it('renders the menu groups and every link for an admin', async () => {
    await open();
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
      'Audit log',
      'Masters',
    ]) {
      expect(n.getByRole('link', { name: l })).toBeInTheDocument();
    }
  });

  it('hides menu items the role has no permission for (ICN)', async () => {
    await open(icnMe);
    const n = within(nav());
    expect(n.getByRole('link', { name: 'Link nurses' })).toBeInTheDocument();
    for (const l of ['Users', 'Roles & permissions', 'Audit log', 'Masters']) {
      expect(n.queryByRole('link', { name: l })).not.toBeInTheDocument();
    }
  });

  it('relabels Sessions and Dashboard for link nurses and hides the rest', async () => {
    await open(nurseMe);
    const n = within(nav());
    expect(n.getByRole('link', { name: 'My sessions' })).toBeInTheDocument();
    expect(n.getByRole('link', { name: 'My wards' })).toBeInTheDocument();
    expect(n.queryByRole('link', { name: 'Ward targets' })).not.toBeInTheDocument();
    expect(n.queryByRole('link', { name: 'Reports centre' })).not.toBeInTheDocument();
    expect(n.getByRole('link', { name: 'Printable sheet' })).toBeInTheDocument();
  });

  it('shows Name · Role and a Sign out button in the top bar', async () => {
    await open();
    expect(screen.getByText('Test Admin · Admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(await screen.findByText(/API online/i)).toBeInTheDocument();
  });

  it('shows other modules as Coming soon and not clickable', async () => {
    await open();
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
    await open();
    const user = userEvent.setup();
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
    await open();
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveFocus();
    await user.tab();
    expect(within(nav()).getByRole('link', { name: 'Home' })).toHaveFocus();
  });

  it('shows a not-found page for unknown routes', async () => {
    await open(adminMe, '/does-not-exist');
    expect(screen.getByRole('heading', { level: 1, name: /page not found/i })).toBeInTheDocument();
  });
});
