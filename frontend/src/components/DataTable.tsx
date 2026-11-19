import type { ReactNode } from 'react';
import s from './ui.module.css';

export type SortOrder = 'asc' | 'desc';

export interface Column<T> {
  key: string;
  header: string;
  /** Server-side sort key. Leave out for columns that cannot be sorted. */
  sortKey?: string;
  align?: 'right';
  /** Keeps the column visible while the table scrolls sideways (use on the first column). */
  sticky?: boolean;
  render: (row: T) => ReactNode;
}

export function SortableTh({
  label,
  sortKey,
  active,
  order,
  onSort,
  align,
  sticky,
}: {
  label: string;
  sortKey: string;
  active: boolean;
  order: SortOrder;
  onSort: (key: string) => void;
  align?: 'right';
  sticky?: boolean;
}) {
  const aria = active ? (order === 'asc' ? 'ascending' : 'descending') : 'none';
  const cls = [align === 'right' ? s.right : '', sticky ? s.sticky : '', active ? s.sorted : '']
    .filter(Boolean)
    .join(' ');
  return (
    <th scope="col" aria-sort={aria} className={cls}>
      <button type="button" className={s.sortBtn} onClick={() => onSort(sortKey)}>
        {label}
        <span className={s.sortMark} aria-hidden="true">
          {active ? (order === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  order,
  onSort,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort: string;
  order: SortOrder;
  onSort: (key: string) => void;
}) {
  return (
    <div className={s.scroller} tabIndex={0} role="region" aria-label={`${caption} (scrollable)`}>
      <table className={s.table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) =>
              c.sortKey ? (
                <SortableTh
                  key={c.key}
                  label={c.header}
                  sortKey={c.sortKey}
                  active={sort === c.sortKey}
                  order={order}
                  onSort={onSort}
                  align={c.align}
                  sticky={c.sticky}
                />
              ) : (
                <th
                  key={c.key}
                  scope="col"
                  className={`${c.align === 'right' ? s.right : ''} ${c.sticky ? s.sticky : ''}`}
                >
                  {c.header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${c.align === 'right' ? s.right : ''} ${c.sticky ? s.sticky : ''}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
