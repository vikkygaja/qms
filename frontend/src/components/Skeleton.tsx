import type { CSSProperties } from 'react';
import s from './ui.module.css';

/** Decorative placeholder block. Pair with a visually hidden "Loading" status for screen readers. */
export function Skeleton({ width, height = 14 }: { width?: number | string; height?: number }) {
  const style: CSSProperties = { width: width ?? '100%', height };
  return <span className={s.skeleton} style={style} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 6, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" style={{ display: 'grid', gap: 12, padding: 12 }}>
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={18} width={`${92 - ((i * 7) % 30)}%`} />
      ))}
    </div>
  );
}
