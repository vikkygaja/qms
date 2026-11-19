import { describe, expect, it } from 'vitest';
import { ApiError, get, getCsrfToken, post, setCsrfToken } from './client';
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
