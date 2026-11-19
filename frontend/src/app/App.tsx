import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';
import { PublicOnly, RequireAuth, RequirePermission } from '../auth/guards';
import { AuditLogPage } from '../pages/admin/AuditLogPage';
import { DepartmentsPage } from '../pages/admin/masters/DepartmentsPage';
import { ImportExportPage } from '../pages/admin/masters/ImportExportPage';
import { KpiPage } from '../pages/admin/masters/KpiPage';
import { MastersOverviewPage } from '../pages/admin/masters/MastersOverviewPage';
import { StaffCategoriesPage } from '../pages/admin/masters/StaffCategoriesPage';
import { WardsPage } from '../pages/admin/masters/WardsPage';
import { RolesPage } from '../pages/admin/RolesPage';
import { UsersPage } from '../pages/admin/UsersPage';
import { LinkNursesPage } from '../pages/hand-hygiene/link-nurses/LinkNursesPage';
import { SheetPage } from '../pages/hand-hygiene/SheetPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { SetPasswordPage } from '../pages/auth/SetPasswordPage';
import { NotFoundPage, PlaceholderPage } from '../pages/PlaceholderPage';
import { NAV_LINKS } from './nav';
import { Shell } from './Shell';

const PAGES: Record<string, ReactNode> = {
  '/admin/users': <UsersPage />,
  '/admin/roles': <RolesPage />,
  '/admin/audit-log': <AuditLogPage />,
  '/admin/masters': <MastersOverviewPage />,
  '/admin/masters/wards': <WardsPage />,
  '/admin/masters/departments': <DepartmentsPage />,
  '/admin/masters/staff-categories': <StaffCategoriesPage />,
  '/admin/masters/kpi': <KpiPage />,
  '/admin/masters/import-export': <ImportExportPage />,
  '/hand-hygiene/link-nurses': <LinkNursesPage />,
  '/hand-hygiene/sheet': <SheetPage />,
};

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />
      <Route
        path="/set-password"
        element={
          <PublicOnly forced>
            <SetPasswordPage />
          </PublicOnly>
        }
      />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          {NAV_LINKS.map((l) => (
            <Route
              key={l.path}
              path={l.path}
              element={
                <RequirePermission permission={l.perm}>
                  {PAGES[l.path] ?? <PlaceholderPage title={l.title ?? l.label} />}
                </RequirePermission>
              }
            />
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

const queryClient = new QueryClient();
const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={routerFuture}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
