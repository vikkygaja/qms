import { useId, useMemo, useState } from 'react';
import s from './linkNurses.module.css';

export interface WardOption {
  id: string;
  name: string;
  department?: string;
  /** Link nurses currently assigned to this ward. */
  count?: number;
}

/**
 * Searchable multi-select of wards: selected chips with a count on top, a filtered checklist below.
 * Controlled; the parent owns the list of selected ids.
 */
export function WardChecklist({
  options,
  selected,
  onChange,
  loading,
  error,
  disabled,
}: {
  options: WardOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const uid = useId();
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const chosen = options.filter((o) => selected.includes(o.id));

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className={s.wardPick}>
      <div className={s.wardHead}>
        <span id={`${uid}-label`}>Assigned wards</span>
        <span aria-live="polite">{selected.length} selected</span>
      </div>
      {chosen.length > 0 && (
        <ul
          className={s.chips}
          aria-label="Selected wards"
          style={{ listStyle: 'none', padding: 0 }}
        >
          {chosen.map((o) => (
            <li key={o.id} className={s.chip}>
              {o.name}
              <button
                type="button"
                className={s.chipX}
                aria-label={`Remove ${byId.get(o.id)?.name ?? o.name}`}
                disabled={disabled}
                onClick={() => toggle(o.id)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="search"
        aria-label="Search wards"
        placeholder="Search wards"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%' }}
      />
      <div className={s.wardList} role="group" aria-labelledby={`${uid}-label`}>
        {loading && (
          <span className="small muted" style={{ padding: 10 }}>
            Loading wards...
          </span>
        )}
        {!loading && shown.length === 0 && (
          <span className="small muted" style={{ padding: 10 }}>
            No wards match.
          </span>
        )}
        {shown.map((o) => (
          <label key={o.id} className={s.wardRow}>
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              disabled={disabled}
              onChange={() => toggle(o.id)}
            />
            {o.name}
            {(o.department !== undefined || o.count !== undefined) && (
              <span className={s.meta}>
                {o.department}
                {o.department !== undefined && o.count !== undefined ? ' · ' : ''}
                {o.count !== undefined && `${o.count} assigned`}
              </span>
            )}
          </label>
        ))}
      </div>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
