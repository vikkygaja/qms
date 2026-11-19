export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: FieldError[];
  constructor(status: number, code: string, message: string, details: FieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Message for one field, if the server reported one. */
  fieldMessage(field: string): string | undefined {
    return this.details.find((d) => d.field === field)?.message;
  }
}

const BASE = '/api/v1';

// The CSRF token lives in memory only. It is never written to browser storage.
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}
export function getCsrfToken() {
  return csrfToken;
}

let unauthorizedHandler: (() => void) | null = null;
/** Called when a request (other than login or /auth/me) gets a 401. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

export type Query = Record<string, string | number | undefined | null>;

interface Options {
  body?: unknown;
  query?: Query;
}

function buildPath(path: string, query?: Query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

export async function api<T>(method: string, path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method, credentials: 'same-origin', headers };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  let res: Response;
  try {
    res = await fetch(buildPath(path, opts.query), init);
  } catch {
    throw new ApiError(
      0,
      'network_error',
      'Cannot reach the server. Check the connection and try again.',
    );
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let code = 'error';
  let message = `Request failed (${res.status}).`;
  let details: FieldError[] = [];
  try {
    const data = await res.json();
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      details = Array.isArray(data.error.details) ? data.error.details : [];
    }
  } catch {
    // body was not JSON: keep the generic message
  }
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
    unauthorizedHandler?.();
  }
  throw new ApiError(res.status, code, message, details);
}

export const get = <T>(path: string, query?: Query) => api<T>('GET', path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, { body });
export const patch = <T>(path: string, body?: unknown) => api<T>('PATCH', path, { body });
export const put = <T>(path: string, body?: unknown) => api<T>('PUT', path, { body });
