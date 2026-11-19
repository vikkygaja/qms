import { describe, expect, it, vi } from 'vitest';
import { ApiError, get, getCsrfToken, post, setCsrfToken, upload } from './client';
import { login } from './auth';
import { adminMe } from '../test/fixtures';
import { apiError, mockApi } from '../test/utils';

describe('api client', () => {
  it('sends same-origin credentials and no CSRF header on GET', async () => {
    const { calls } = mockApi(() => ({ body: { ok: true } }));
    setCsrfToken('tok');
    await get('/users', { q: 'abc', status: '' });
    expect(calls[0].credentials).toBe('same-origin');
    expect(calls[0].headers.get('X-CSRF-Token')).toBeNull();
    expect(calls[0].query.get('q')).toBe('abc');
    expect(calls[0].query.has('status')).toBe(false);
  });

  it('sends the CSRF header on POST', async () => {
    const { calls } = mockApi(() => ({ body: {} }));
    setCsrfToken('tok-123');
    await post('/roles', { name: 'X' });
    expect(calls[0].headers.get('X-CSRF-Token')).toBe('tok-123');
    expect(calls[0].body).toEqual({ name: 'X' });
  });

  it('parses the standard error format into ApiError', async () => {
    mockApi(() =>
      apiError(422, 'validation_error', 'Check the form.', [
        { field: 'mobile', message: 'Mobile must be 10 digits.' },
      ]),
    );
    const err = await post('/users', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(422);
    expect(e.code).toBe('validation_error');
    expect(e.message).toBe('Check the form.');
    expect(e.fieldMessage('mobile')).toBe('Mobile must be 10 digits.');
  });

  it('turns a network failure into a readable ApiError', async () => {
    const { vi } = await import('vitest');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    await expect(get('/users')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });

  it('keeps the CSRF token in memory only, never in browser storage', async () => {
    mockApi(() => ({ body: { user: adminMe, csrf_token: 'secret-csrf' } }));
    await login('ADMIN', 'pw-never-stored-1');
    expect(getCsrfToken()).toBe('secret-csrf');
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump).not.toContain('secret-csrf');
    expect(dump).not.toContain('pw-never-stored-1');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('upload', () => {
  it('sends the CSRF header, no Content-Type, and parses API errors', async () => {
    setCsrfToken('tok');
    const fn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 'validation_error', message: 'Bad file.', details: [] },
          }),
          { status: 422 },
        ),
      );
    vi.stubGlobal('fetch', fn);
    const form = new FormData();
    form.append('file', new File(['x'], 'a.csv'));
    await upload('/masters/import', form, { kind: 'wards', dry_run: 'true' });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/v1/masters/import?kind=wards&dry_run=true');
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('tok');
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
    expect(init.body).toBe(form);
    await expect(upload('/masters/import', form)).rejects.toBeInstanceOf(ApiError);
  });
});
