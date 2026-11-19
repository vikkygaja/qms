import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthProvider';

function Loading() {
  return (
    <p role="status" className="muted" style={{ padding: 20 }}>
      Loading…
    </p>
  );
}

function LoadFailed() {
  const { retry } = useAuth();
  return (
    <section className="card" style={{ margin: 20 }}>
      <h1>Cannot reach QMS</h1>
      <p role="alert" className="err">
        The server did not respond. Check the connection and try again.
      </p>
      <div>
        <button type="button" className="btn" onClick={retry}>
          Try again
        </button>
      </div>
    </section>
  );
}

/** Signed out -> /login. Must change password -> /set-password. Otherwise render children. */
export function RequireAuth() {
  const { user, isLoading, loadError } = useAuth();
  if (isLoading) return <Loading />;
  if (loadError) return <LoadFailed />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/set-password" replace />;
  return <Outlet />;
}

/** For /login and /set-password. */
export function PublicOnly({ children, forced }: { children: ReactNode; forced?: boolean }) {
  const { user, isLoading, loadError } = useAuth();
  if (isLoading) return <Loading />;
  if (loadError) return <LoadFailed />;
  if (forced) {
    if (!user) return <Navigate to="/login" replace />;
    if (!user.must_change_password) return <Navigate to="/" replace />;
    return <>{children}</>;
  }
  if (user) return <Navigate to={user.must_change_password ? '/set-password' : '/'} replace />;
  return <>{children}</>;
}

export function RequirePermission({
  permission,
  children,
}: {
  permission?: string;
  children: ReactNode;
}) {
  const { can } = useAuth();
  if (permission && !can(permission)) {
    return (
      <section className="card">
        <h1>No access</h1>
        <p className="muted">
          Your role does not include this page. Ask an administrator if you need it.
        </p>
      </section>
    );
  }
  return <>{children}</>;
}
