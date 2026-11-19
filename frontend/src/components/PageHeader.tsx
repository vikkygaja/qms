import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import s from './ui.module.css';

export interface Crumb {
  label: string;
  to?: string;
}

/** Breadcrumb, title (with optional count), description and page-level actions. */
export function PageHeader({
  crumbs,
  title,
  count,
  description,
  actions,
}: {
  crumbs?: Crumb[];
  title: string;
  count?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={s.header}>
      {crumbs && crumbs.length > 0 && (
        <nav className={s.crumbs} aria-label="Breadcrumb">
          <ol>
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={c.label} aria-current={last ? 'page' : undefined}>
                  {c.to && !last ? <Link to={c.to}>{c.label}</Link> : c.label}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <div className={s.titleRow}>
        <div className={s.titleLine}>
          <h1>{title}</h1>
          {count !== undefined && <span className={s.count}>{count}</span>}
        </div>
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
      {description && <p className={s.desc}>{description}</p>}
    </header>
  );
}
