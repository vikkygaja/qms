import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ItemStatus } from '../../../api/types';
import type { SortOrder } from '../../../components/DataTable';

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;
export type StatusFilter = 'active' | 'inactive' | 'all';

export interface ListState {
  q: string;
  status: StatusFilter;
  sort: string;
  order: SortOrder;
  page: number;
  pageSize: number;
  extra: Record<string, string>;
}

export const statusParam = (s: StatusFilter): ItemStatus | undefined =>
  s === 'active' ? 'Active' : s === 'inactive' ? 'Inactive' : undefined;

/**
 * List state (search, status, sort, page, page size and extra filters) kept in the URL query string,
 * so refresh, back and shared links restore the same view. Defaults are left out of the URL.
 */
export function useListParams(defaultSort: string, extraKeys: string[] = []) {
  const [sp, setSp] = useSearchParams();
  const extraSig = extraKeys.join(',');

  const state = useMemo<ListState>(() => {
    const st = sp.get('status');
    const size = Number(sp.get('page_size'));
    const extra: Record<string, string> = {};
    for (const k of extraSig ? extraSig.split(',') : []) {
      const v = sp.get(k);
      if (v) extra[k] = v;
    }
    return {
      q: sp.get('q') ?? '',
      status: st === 'inactive' || st === 'all' ? st : 'active',
      sort: sp.get('sort') || defaultSort,
      order: sp.get('order') === 'desc' ? 'desc' : 'asc',
      page: Math.max(1, Math.floor(Number(sp.get('page'))) || 1),
      pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
      extra,
    };
  }, [sp, defaultSort, extraSig]);

  /** Merge changes into the URL. Any change except page itself returns to page 1. */
  const update = useCallback(
    (patch: Record<string, string | undefined>, opts: { replace?: boolean } = {}) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '') next.delete(k);
            else next.set(k, v);
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: opts.replace },
      );
    },
    [setSp],
  );

  const toggleSort = useCallback(
    (key: string) =>
      update(
        key === state.sort
          ? { order: state.order === 'asc' ? 'desc' : 'asc' }
          : { sort: key, order: 'asc' },
      ),
    [update, state.sort, state.order],
  );

  return { state, update, toggleSort };
}
