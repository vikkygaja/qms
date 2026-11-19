import type { ReactNode } from 'react';
import s from './ui.module.css';

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children && <div className={s.emptyActions}>{children}</div>}
    </div>
  );
}
