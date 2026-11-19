import type { ReactNode } from 'react';
import s from './ui.module.css';

/** Row of labelled filter controls. Enter inside the search box does not reload the page. */
export function FilterBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <form
      className={s.filters}
      role="search"
      aria-label={label}
      onSubmit={(e) => e.preventDefault()}
    >
      {children}
    </form>
  );
}
