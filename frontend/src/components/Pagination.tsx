export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="row between" aria-label="Pagination">
      <span className="small muted">
        Page {page} of {pages} · {total} {total === 1 ? 'record' : 'records'}
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
