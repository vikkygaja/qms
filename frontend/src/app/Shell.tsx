import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { HealthBadge } from '../components/HealthBadge';
import { useAuth } from '../auth/AuthProvider';
import { LINK_NURSE_ROLE, navSections, type NavLinkItem, type NavSection } from './nav';
import styles from './Shell.module.css';

const STORE_KEY = 'qms.nav.open';
// "Other modules" (all Soon items) starts collapsed; everything else starts open.
const DEFAULT_CLOSED = new Set(['Other modules']);

/** Open/closed choices are a UI preference only (nothing about the user); storage may be missing. */
function loadOpen(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}
function saveOpen(v: Record<string, boolean>) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    // ignore: the menu still works, it just forgets the choice
  }
}

const containsPath = (g: NavSection, pathname: string) =>
  g.items.some((i) => i.kind === 'link' && i.path === pathname);

function NavMenu({
  top,
  groups,
  isLinkNurse,
  pathname,
}: {
  top: NavLinkItem[];
  groups: NavSection[];
  isLinkNurse: boolean;
  pathname: string;
}) {
  const [stored, setStored] = useState(loadOpen);
  const current = groups.find((g) => containsPath(g, pathname))?.label;

  // Navigating into a group opens it (and remembers that).
  useEffect(() => {
    if (!current) return;
    setStored((prev) => {
      if (prev[current] === true) return prev;
      const next = { ...prev, [current]: true };
      saveOpen(next);
      return next;
    });
  }, [current]);

  const isOpen = (label: string) =>
    label === current || (stored[label] ?? !DEFAULT_CLOSED.has(label));
  const toggle = (label: string) => {
    if (label === current) return; // the group holding the current page stays open
    setStored((prev) => {
      const next = { ...prev, [label]: !isOpen(label) };
      saveOpen(next);
      return next;
    });
  };
  const text = (l: NavLinkItem) => (isLinkNurse && l.lnLabel ? l.lnLabel : l.label);

  return (
    <>
      {top.map((l) => (
        <NavLink key={l.path} to={l.path} end className={styles.item}>
          {text(l)}
        </NavLink>
      ))}
      {groups.map((g) => {
        const open = isOpen(g.label);
        const gid = `navgrp-${g.label.replace(/\W+/g, '-').toLowerCase()}`;
        return (
          <div key={g.label} className={styles.sect}>
            <button
              type="button"
              className={`${styles.ghead} ${g.label === current ? styles.hasCurrent : ''}`}
              aria-expanded={open}
              aria-controls={gid}
              onClick={() => toggle(g.label)}
            >
              <span>{g.label}</span>
              <span className={`${styles.chev} ${open ? styles.chevOpen : ''}`} aria-hidden="true">
                ›
              </span>
            </button>
            <div id={gid} hidden={!open} className={styles.gitems}>
              {g.items.map((e) =>
                e.kind === 'soon' ? (
                  <div
                    key={e.label}
                    className={`${styles.item} ${styles.sub} ${styles.soon}`}
                    aria-disabled="true"
                  >
                    <span>{e.label}</span>
                    <span className={styles.tag}>Soon</span>
                  </div>
                ) : (
                  <NavLink key={e.path} to={e.path} end className={`${styles.item} ${styles.sub}`}>
                    {text(e)}
                  </NavLink>
                ),
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function Shell() {
  const { user, can, logout } = useAuth();
  const isLinkNurse = user?.role.key === LINK_NURSE_ROLE;
  const { pathname } = useLocation();
  const sections = navSections(can);
  return (
    <>
      <a className={`${styles.skip} no-print`} href="#main">
        Skip to content
      </a>
      <div className={`${styles.app} print-flat`}>
        <nav className={`${styles.nav} no-print`} aria-label="Main">
          <div className={styles.logo}>
            QMS<small>Sri Narayani Hospital</small>
          </div>
          <NavMenu
            top={sections.top}
            groups={sections.groups}
            isLinkNurse={isLinkNurse}
            pathname={pathname}
          />
        </nav>
        <div className={styles.main}>
          <header className={`${styles.top} no-print`}>
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
