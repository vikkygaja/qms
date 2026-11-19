import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setCsrfToken, setUnauthorizedHandler } from '../api/client';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  setCsrfToken(null);
  setUnauthorizedHandler(null);
});
