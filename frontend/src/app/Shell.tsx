import { NavLink, Outlet } from 'react-router-dom';
import { HealthBadge } from '../components/HealthBadge';
import { useAuth } from '../auth/AuthProvider';
import { LINK_NURSE_ROLE, visibleNav } from './nav';
import styles from './Shell.module.css';

export function Shell() {
  const { user, can, logout } = useAuth();
  const isLinkNurse = user?.role.key === LINK_NURSE_ROLE;
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <div className={styles.app}>
        <nav className={styles.nav} aria-label="Main">
          <div className={styles.logo}>
            QMS<small>Sri Narayani Hospital</small>
          </div>
          {visibleNav(can).map((e) => {
            if (e.kind === 'group') {
              return (
                <div key={`g-${e.label}`} className={styles.group}>
                  {e.label}
                </div>
              );
            }
            if (e.kind === 'soon') {
              return (
                <div
                  key={e.label}
                  className={`${styles.item} ${styles.sub} ${styles.soon}`}
                  aria-disabled="true"
                >
                  <span>{e.label}</span>
                  <span className={styles.tag}>Soon</span>
                </div>
              );
            }
            return (
              <NavLink
                key={e.path}
                to={e.path}
                end
                className={`${styles.item} ${e.sub ? styles.sub : ''}`}
              >
                {isLinkNurse && e.lnLabel ? e.lnLabel : e.label}
              </NavLink>
            );
          })}
        </nav>
        <div className={styles.main}>
          <header className={styles.top}>
            <strong>Hospital Quality Management System</strong>
            <div className={styles.who}>
              <span>
                {user?.full_name} · {user?.role.name}
              </span>
              <button type="button" className="btn ghost sm" onClick={() => void logout()}>
                Sign out
              </button>
              <HealthBadge />
            </div>
          </header>
          <main id="main" tabIndex={-1} className={styles.content}>
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}
