import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { AppRoutes } from '../app/App';
import { adminMe, CAT_DOCTOR, DEPT_GEN, DEPT_ICU, page, SUMMARY, WARD_MICU } from './fixtures';
import { mockApi, renderWithAuth, withSession, type ApiHandler } from './utils';

/** Session handler with default master data; `extra` can override any call. */
export const masterApi = (extra: ApiHandler = () => undefined): ApiHandler =>
  withSession(adminMe, (c) => {
    const r = extra(c);
    if (r) return r;
    if (c.method !== 'GET') return undefined;
    if (c.path === '/wards') return { body: page([WARD_MICU]) };
    if (c.path === '/departments') return { body: page([DEPT_ICU, DEPT_GEN]) };
    if (c.path === '/staff-categories') return { body: page([CAT_DOCTOR]) };
    if (c.path === '/settings/kpi') return { body: SUMMARY.kpi };
    if (c.path === '/masters/summary') return { body: SUMMARY };
    return undefined;
  });

/** Render the real routes at `route` (signed in as admin). */
export async function openAt(route: string, extra?: ApiHandler, waitFor?: string) {
  const m = mockApi(masterApi(extra));
  renderWithAuth(<AppRoutes />, route);
  if (waitFor) await screen.findByText(waitFor);
  else await screen.findByRole('main');
  return { ...m, user: userEvent.setup() };
}
