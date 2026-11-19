import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { getKpiSettings, saveKpiSettings } from '../../api/masters';

type Key = 'green' | 'amber' | 'inactive_days';

export function KpiCard({ onSaved }: { onSaved: (message: string) => void }) {
  const qc = useQueryClient();
  const kpi = useQuery({ queryKey: ['masters', 'kpi'], queryFn: getKpiSettings });
  const [v, setV] = useState({ green: '', amber: '', inactive_days: '' });
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [general, setGeneral] = useState('');

  useEffect(() => {
    if (kpi.data)
      setV({
        green: String(kpi.data.green),
        amber: String(kpi.data.amber),
        inactive_days: String(kpi.data.inactive_days),
      });
  }, [kpi.data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setGeneral('');
    const g = Number(v.green);
    const a = Number(v.amber);
    const d = Number(v.inactive_days);
    const found: Partial<Record<Key, string>> = {};
    if (!Number.isInteger(g) || v.green === '' || g > 100)
      found.green = 'Enter a whole number up to 100.';
    if (!Number.isInteger(a) || v.amber === '' || a < 1)
      found.amber = 'Enter a whole number of 1 or more.';
    if (!found.green && !found.amber && a >= g) found.amber = 'Amber must be lower than green.';
    if (!Number.isInteger(d) || v.inactive_days === '' || d < 1 || d > 365)
      found.inactive_days = 'Enter a whole number from 1 to 365.';
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const saved = await saveKpiSettings({ green: g, amber: a, inactive_days: d });
      qc.setQueryData(['masters', 'kpi'], saved);
      onSaved('KPI thresholds saved.');
    } catch (err) {
      if (err instanceof ApiError) {
        const fields: Partial<Record<Key, string>> = {};
        for (const det of err.details) fields[det.field as Key] = det.message;
        setErrors(fields);
        if (err.details.length === 0) setGeneral(err.message);
      } else setGeneral('Something went wrong. Try again.');
    }
  }

  const field = (key: Key, label: string) => (
    <label className="f" htmlFor={`kpi-${key}`}>
      {label}
      <input
        id={`kpi-${key}`}
        type="number"
        style={{ width: 110 }}
        value={v[key]}
        onChange={(e) => setV((p) => ({ ...p, [key]: e.target.value }))}
        aria-invalid={!!errors[key]}
      />
      {errors[key] && (
        <span className="err" role="alert">
          {errors[key]}
        </span>
      )}
    </label>
  );

  return (
    <section className="card" aria-labelledby="kpi-h">
      <h2 id="kpi-h">KPI thresholds</h2>
      {kpi.isError && (
        <p role="alert" className="err">
          Could not load the thresholds.
        </p>
      )}
      <form
        className="row"
        style={{ alignItems: 'start' }}
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        {field('green', 'Green from (%)')}
        {field('amber', 'Amber from (%)')}
        {field('inactive_days', 'Inactive after (days)')}
        <button type="submit" className="btn sm" style={{ marginTop: 20 }} disabled={!kpi.data}>
          Save thresholds
        </button>
      </form>
      {general && (
        <p role="alert" className="err">
          {general}
        </p>
      )}
      <p className="small muted">
        Low-compliance alerts go to every role with &quot;Receive low-compliance alerts&quot; (see
        Roles &amp; permissions).
      </p>
    </section>
  );
}
