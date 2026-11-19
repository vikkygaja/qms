import { NavLink, Outlet } from 'react-router-dom';
import { HealthBadge } from '../components/HealthBadge';
import { NAV } from './nav';
import styles from './Shell.module.css';

export function Shell() {
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
          {NAV.map((e) => {
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
                {e.label}
              </NavLink>
            );
          })}
        </nav>
        <div className={styles.main}>
          <header className={styles.top}>
            <strong>Hospital Quality Management System</strong>
            <HealthBadge />
          </header>
          <main id="main" tabIndex={-1} className={styles.content}>
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}
