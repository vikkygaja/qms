import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './App';
import { adminMe, icnMe } from '../test/fixtures';
import { mockApi, renderWithAuth, withSession } from '../test/utils';
import type { Me } from '../api/types';

const nav = () => within(screen.getByRole('navigation', { name: /main/i }));
async function open(me: Me = adminMe, route = '/') {
  mockApi(withSession(me));
  renderWithAuth(<AppRoutes />, route);
  await screen.findByRole('navigation', { name: /main/i });
  return userEvent.setup();
}
const header = (name: string) => nav().getByRole('button', { name });

describe('Accordion menu', () => {
  it('keeps Home standalone and shows group headers as buttons', async () => {
    await open();
    expect(nav().getByRole('link', { name: 'Home' })).toBeInTheDocument();
    for (const g of ['Hand Hygiene', 'Masters', 'Platform', 'Other modules'])
      expect(header(g)).toHaveAttribute('aria-expanded');
  });

  it('hides a whole group when no item is permitted', async () => {
    await open(icnMe);
    expect(nav().queryByRole('button', { name: 'Masters' })).not.toBeInTheDocument();
    expect(nav().queryByRole('button', { name: 'Platform' })).toBeInTheDocument(); // Reports centre
    expect(nav().getByRole('button', { name: 'Hand Hygiene' })).toBeInTheDocument();
  });

  it('toggles a group with the keyboard and updates aria-expanded', async () => {
    const user = await open();
    const h = header('Masters');
    expect(h).toHaveAttribute('aria-expanded', 'true');
    h.focus();
    await user.keyboard('{Enter}');
    expect(h).toHaveAttribute('aria-expanded', 'false');
    expect(nav().queryByRole('link', { name: 'Wards' })).not.toBeInTheDocument();
    await user.keyboard(' ');
    expect(h).toHaveAttribute('aria-expanded', 'true');
    expect(nav().getByRole('link', { name: 'Wards' })).toBeInTheDocument();
  });

  it('opens the group holding the current page and keeps it open', async () => {
    const user = await open(adminMe, '/admin/audit-log');
    const platform = header('Platform');
    expect(platform).toHaveAttribute('aria-expanded', 'true');
    expect(nav().getByRole('link', { name: 'Audit log' })).toHaveAttribute('aria-current', 'page');
    await user.click(platform);
    expect(platform).toHaveAttribute('aria-expanded', 'true');
  });

  it('restores remembered open/closed choices', async () => {
    window.localStorage.setItem('qms.nav.open', JSON.stringify({ 'Hand Hygiene': false }));
    await open();
    expect(header('Hand Hygiene')).toHaveAttribute('aria-expanded', 'false');
    expect(header('Masters')).toHaveAttribute('aria-expanded', 'true');
  });

  it('remembers a choice for the next visit', async () => {
    const user = await open();
    await user.click(header('Masters'));
    expect(JSON.parse(window.localStorage.getItem('qms.nav.open') ?? '{}')).toMatchObject({
      Masters: false,
    });
  });

  it('collapses Other modules by default and its Soon items are not links', async () => {
    const user = await open();
    const h = header('Other modules');
    expect(h).toHaveAttribute('aria-expanded', 'false');
    await user.click(h);
    expect(nav().getByText('CAPA').closest('[aria-disabled="true"]')).not.toBeNull();
    expect(nav().queryByRole('link', { name: /CAPA/ })).not.toBeInTheDocument();
  });
});
