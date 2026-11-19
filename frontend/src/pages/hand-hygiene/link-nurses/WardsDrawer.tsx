import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../../api/client';
import { getLinkNurse, setLinkNurseWards } from '../../../api/linkNurses';
import { listWards } from '../../../api/masters';
import type { LinkNurse } from '../../../api/types';
import { Drawer } from '../../../components/Drawer';
import { HistoryPanel } from './HistoryPanel';
import { WardChecklist, type WardOption } from './WardChecklist';

export const ONE_WARD_RULE = 'Keep at least one ward, or make the link nurse inactive instead.';

/** Active wards as checklist options, plus any ward the nurse still holds that is no longer Active. */
export function useWardOptions(extra: { id: string; name: string }[] = []) {
  const q = useQuery({
    queryKey: ['masters', 'wards', 'active-options'],
    queryFn: () => listWards({ status: 'Active', page_size: 500 }),
  });
  const options: WardOption[] = (q.data?.items ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    department: w.department.name,
    count: w.link_nurse_count,
  }));
  if (q.isSuccess)
    for (const w of extra) if (!options.some((o) => o.id === w.id)) options.push({ ...w });
  return { options, query: q };
}

/** Change a link nurse's wards (history kept), or just read the history when readOnly. */
export function WardsDrawer({
  nurse,
  readOnly,
  onClose,
  onSaved,
}: {
  nurse: LinkNurse;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(nurse.wards.map((w) => w.id));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { options, query: wardsQ } = useWardOptions(nurse.wards);
  const detail = useQuery({
    queryKey: ['link-nurses', 'detail', nurse.id],
    queryFn: () => getLinkNurse(nurse.id),
  });

  async function save() {
    if (selected.length === 0) return setError(ONE_WARD_RULE);
    const before = nurse.wards.map((w) => w.id);
    if (selected.length === before.length && selected.every((id) => before.includes(id)))
      return onSaved('No ward changes to save.');
    setError('');
    setBusy(true);
    try {
      await setLinkNurseWards(nurse.id, selected);
      onSaved(`Wards updated for ${nurse.full_name}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <Drawer
      wide
      title={readOnly ? `History: ${nurse.full_name}` : `Wards: ${nurse.full_name}`}
      description={
        readOnly
          ? 'Ward assignments and status changes. Nothing here can be edited.'
          : 'Ticking or unticking a ward starts or ends an assignment today. History is kept.'
      }
      onClose={onClose}
      footer={
        readOnly ? (
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
              Save wards
            </button>
          </>
        )
      }
    >
      <div style={{ display: 'grid', gap: 20 }}>
        {!readOnly && (
          <div style={{ display: 'grid', gap: 8 }}>
            <WardChecklist
              options={options}
              selected={selected}
              onChange={(ids) => {
                setSelected(ids);
                setError('');
              }}
              loading={wardsQ.isPending}
              error={error || (wardsQ.isError ? 'Could not load wards.' : undefined)}
            />
            <p className="small muted">
              A link nurse keeps at least one ward. To remove the last one, make the link nurse
              inactive instead.
            </p>
          </div>
        )}
        {detail.isPending && (
          <p role="status" className="small muted">
            Loading history...
          </p>
        )}
        {detail.isError && (
          <div role="alert" className="err">
            Could not load history.{' '}
            <button type="button" className="btn ghost sm" onClick={() => void detail.refetch()}>
              Try again
            </button>
          </div>
        )}
        {detail.data && <HistoryPanel detail={detail.data} />}
      </div>
    </Drawer>
  );
}
