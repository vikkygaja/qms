import type { ReactNode } from 'react';

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  /** Replaces the default "Page x of y · n records" text. */
  label?: ReactNode;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="row between" aria-label="Pagination">
      <span className="small muted">
        {label ?? (
          <>
            Page {page} of {pages} · {total} {total === 1 ? 'record' : 'records'}
          </>
        )}
      </span>
      <span className="row">
        <button
          type="button"
          className="btn ghost sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </span>
    </nav>
  );
}
