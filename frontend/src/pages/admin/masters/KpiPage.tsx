import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../../api/client';
import { getKpiSettings, saveKpiSettings } from '../../../api/masters';
import { PageHeader } from '../../../components/PageHeader';
import { SkeletonRows } from '../../../components/Skeleton';
import { useToast } from '../../../lib/useToast';
import s from './masters.module.css';

type Key = 'green' | 'amber' | 'inactive_days';
const isInt = (v: string) => v.trim() !== '' && Number.isInteger(Number(v));

/** Bands for the preview, or null while the entered values are not valid. */
function bandsOf(green: string, amber: string) {
  if (!isInt(green) || !isInt(amber)) return null;
  const g = Number(green);
  const a = Number(amber);
  if (a < 1 || g > 100 || a >= g) return null;
  return { g, a };
}

export function KpiPage() {
  const qc = useQueryClient();
  const toast = useToast();
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
    if (!isInt(v.green) || g > 100) found.green = 'Enter a whole number up to 100.';
    if (!isInt(v.amber) || a < 1) found.amber = 'Enter a whole number of 1 or more.';
    if (!found.green && !found.amber && a >= g) found.amber = 'Amber must be lower than green.';
    if (!isInt(v.inactive_days) || d < 1 || d > 365)
      found.inactive_days = 'Enter a whole number from 1 to 365.';
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const saved = await saveKpiSettings({ green: g, amber: a, inactive_days: d });
      qc.setQueryData(['masters', 'kpi'], saved);
      void qc.invalidateQueries({ queryKey: ['masters', 'summary'] });
      toast.show('KPI thresholds saved.');
    } catch (err) {
      if (err instanceof ApiError) {
        const fields: Partial<Record<Key, string>> = {};
        for (const det of err.details) fields[det.field as Key] = det.message;
        setErrors(fields);
        if (err.details.length === 0) setGeneral(err.message);
      } else setGeneral('Something went wrong. Try again.');
    }
  }

  const field = (key: Key, label: string, help: string) => (
    <div className="f" style={{ display: 'grid', gap: 3 }}>
      <label htmlFor={`kpi-${key}`} style={{ font: 'inherit', fontWeight: 600 }}>
        {label}
      </label>
      <input
        id={`kpi-${key}`}
        type="number"
        style={{ width: 130 }}
        value={v[key]}
        onChange={(e) => setV((p) => ({ ...p, [key]: e.target.value }))}
        aria-invalid={!!errors[key]}
        aria-describedby={`kpi-${key}-help`}
      />
      <span id={`kpi-${key}-help`} className={s.hint}>
        {help}
      </span>
      {errors[key] && (
        <span className="err" role="alert">
          {errors[key]}
        </span>
      )}
    </div>
  );

  const b = bandsOf(v.green, v.amber);

  return (
    <div className={s.page}>
      <PageHeader
        crumbs={[{ label: 'Masters', to: '/admin/masters' }, { label: 'KPI thresholds' }]}
        title="KPI thresholds"
        description="Decide when hand hygiene compliance is shown green, amber or red, and when a ward is reminded to enter data."
      />
      {kpi.isError && (
        <p role="alert" className="err">
          Could not load the thresholds.
        </p>
      )}
      {kpi.isPending && <SkeletonRows rows={4} label="Loading thresholds" />}
      {kpi.data && (
        <div className={s.kpiLayout}>
          <form className={s.panel} onSubmit={(e) => void submit(e)} noValidate>
            {field('green', 'Green from (%)', 'At or above this is green.')}
            {field('amber', 'Amber from (%)', 'At or above this, but below green, is amber.')}
            {field(
              'inactive_days',
              'Inactive after (days)',
              'Days without any entry before alert.',
            )}
            {general && (
              <p role="alert" className="err">
                {general}
              </p>
            )}
            <div>
              <button type="submit" className="btn">
                Save thresholds
              </button>
            </div>
          </form>
          <section className={s.panel} aria-labelledby="kpi-prev">
            <h2 id="kpi-prev" style={{ fontSize: '1rem' }}>
              Preview
            </h2>
            {b ? (
              <>
                <div
                  className={s.bar}
                  role="img"
                  aria-label={`Red 0 to ${b.a - 1} percent, amber ${b.a} to ${b.g - 1} percent, green ${b.g} to 100 percent`}
                >
                  <span className={s.red} style={{ width: `${b.a}%` }} />
                  <span className={s.amber} style={{ width: `${b.g - b.a}%` }} />
                  <span className={s.green} style={{ width: `${100 - b.g}%` }} />
                </div>
                <div className={s.axis} aria-hidden="true">
                  <span>0%</span>
                  <span>{b.a}%</span>
                  <span>{b.g}%</span>
                  <span>100%</span>
                </div>
                <ul className={s.legend}>
                  <li>
                    <span className={`${s.swatch} ${s.red}`} aria-hidden="true" />
                    Red: below {b.a}% (0 to {b.a - 1}%)
                  </li>
                  <li>
                    <span className={`${s.swatch} ${s.amber}`} aria-hidden="true" />
                    Amber: {b.a}% to {b.g - 1}%
                  </li>
                  <li>
                    <span className={`${s.swatch} ${s.green}`} aria-hidden="true" />
                    Green: {b.g}% to 100%
                  </li>
                </ul>
              </>
            ) : (
              <p className="muted small">
                Enter whole numbers with amber lower than green (green up to 100) to see the bands.
              </p>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              Compliance at or above green is shown green. At or above amber but below green is
              amber. Anything lower is red. If a ward enters nothing for the number of days set
              above, it is flagged as inactive. Low-compliance alerts go to every role with
              &quot;Receive low-compliance alerts&quot; (see Roles &amp; permissions).
            </p>
          </section>
        </div>
      )}
      {toast.node}
    </div>
  );
}
