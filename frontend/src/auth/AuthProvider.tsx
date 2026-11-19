import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import * as authApi from '../api/auth';
import { ApiError, setCsrfToken, setUnauthorizedHandler } from '../api/client';
import type { Me } from '../api/types';

interface AuthValue {
  user: Me | null;
  isLoading: boolean;
  /** Set when /auth/me failed for a reason other than "signed out". */
  loadError: Error | null;
  retry: () => void;
  can: (permission: string) => boolean;
  login: (employeeId: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<Me>;
}

const AuthContext = createContext<AuthValue | null>(null);
const ME_KEY = ['me'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const me = useQuery<Me | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await authApi.fetchMe();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw e;
      }
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const clearSession = useCallback(() => {
    setCsrfToken(null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'health' });
    qc.setQueryData(ME_KEY, null);
  }, [qc]);

  // A 401 on any other call (idle timeout, ended by an admin) signs the user out.
  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  const value = useMemo<AuthValue>(() => {
    const user = me.data ?? null;
    const perms = new Set(user?.permissions ?? []);
    return {
      user,
      isLoading: me.isPending,
      loadError: me.isError ? me.error : null,
      retry: () => void me.refetch(),
      can: (p) => perms.has(p),
      login: async (employeeId, password) => {
        const u = await authApi.login(employeeId, password);
        qc.setQueryData(ME_KEY, u);
        return u;
      },
      logout: async () => {
        try {
          await authApi.logout();
        } catch {
          // even if the server call fails, drop the local session state
        }
        clearSession();
      },
      changePassword: async (current, next) => {
        const u = await authApi.changePassword(current, next);
        qc.setQueryData(ME_KEY, u);
        return u;
      },
    };
  }, [me, qc, clearSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
