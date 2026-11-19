import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { Me } from '../api/types';
import { AuthProvider } from '../auth/AuthProvider';

export function stubHealth(ok: boolean) {
  const fetchMock = ok
    ? vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok', version: '0.1.0', db: 'up' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    : vi.fn().mockRejectedValue(new TypeError('network down'));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export interface ApiCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
  credentials?: RequestCredentials;
}
export interface ApiReply {
  status?: number;
  body?: unknown;
}
export type ApiHandler = (call: ApiCall) => ApiReply | undefined | void;

export const apiError = (
  status: number,
  code: string,
  message: string,
  details: { field: string; message: string }[] = [],
): ApiReply => ({ status, body: { error: { code, message, details } } });

/** Stubs fetch with a handler keyed on method + path (path without /api/v1). */
export function mockApi(handler: ApiHandler) {
  const calls: ApiCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const call: ApiCall = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname.replace(/^\/api\/v1/, ''),
      query: url.searchParams,
      body:
        init?.body instanceof FormData
          ? init.body
          : init?.body
            ? JSON.parse(String(init.body))
            : undefined,
      headers: new Headers(init?.headers),
      credentials: init?.credentials,
    };
    calls.push(call);
    const reply: ApiReply | undefined | void =
      call.path === '/health'
        ? { body: { status: 'ok', version: '0.1.0', db: 'up' } }
        : handler(call);
    const r = reply ?? apiError(404, 'not_found', `No mock for ${call.method} ${call.path}`);
    const status = r.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(r.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function renderWithProviders(ui: ReactElement, route = '/', opts: { auth?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const body = opts.auth ? <AuthProvider>{ui}</AuthProvider> : ui;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[route]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {body}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Render with the auth provider (for pages that need the signed-in user). */
export const renderWithAuth = (ui: ReactElement, route = '/') =>
  renderWithProviders(ui, route, { auth: true });

/** Handler for a signed-in session: /auth/me answers with the user, the rest goes to `extra`. */
export function withSession(me: Me, extra: ApiHandler = () => undefined): ApiHandler {
  return (call) =>
    call.path === '/auth/me' ? { body: { user: me, csrf_token: 'csrf-1' } } : extra(call);
}

/** Handler for a signed-out visitor. */
export const signedOut =
  (extra: ApiHandler = () => undefined): ApiHandler =>
  (call) =>
    call.path === '/auth/me' ? apiError(401, 'unauthenticated', 'Sign in required.') : extra(call);
