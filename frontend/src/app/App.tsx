import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { NotFoundPage, PlaceholderPage } from '../pages/PlaceholderPage';
import { NAV_LINKS } from './nav';
import { Shell } from './Shell';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        {NAV_LINKS.map((l) => (
          <Route
            key={l.path}
            path={l.path}
            element={<PlaceholderPage title={l.title ?? l.label} />}
          />
        ))}
        <Route path="*" element={<NotFoundPage />} />
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
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
