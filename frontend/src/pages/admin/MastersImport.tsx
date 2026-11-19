import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { importMasters, templateUrl } from '../../api/masters';
import type { ExportKind, ImportReport, ImportRow } from '../../api/types';

const KINDS: { value: ExportKind; label: string }[] = [
  { value: 'wards', label: 'Wards' },
  { value: 'departments', label: 'Departments' },
  { value: 'staff-categories', label: 'Staff categories' },
];

const isCsv = (f: File) => /\.csv$/i.test(f.name);
const isXlsx = (f: File) => /\.xlsx$/i.test(f.name);

const PILL: Record<ImportRow['action'], string> = {
  create: 'p-good',
  update: 'p-n',
  unchanged: 'p-n',
  error: 'p-bad',
};

export function MastersImport({ onApplied }: { onApplied: (message: string) => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<ExportKind | ''>('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const csv = file ? isCsv(file) : false;
  const messageOf = (e: unknown) =>
    e instanceof ApiError ? e.message : 'Something went wrong. Try again.';

  function reset() {
    setFile(null);
    setKind('');
    setReport(null);
    setError('');
    setInputKey((k) => k + 1);
  }

  function effectiveKind(): ExportKind | null {
    if (!file) return null;
    if (csv) return kind && kind !== 'all' ? kind : null;
    return kind || 'all';
  }

  async function preview() {
    setError('');
    setReport(null);
    if (!file) return setError('Choose a file first.');
    if (!isCsv(file) && !isXlsx(file)) return setError('Choose an .xlsx or .csv file.');
    const k = effectiveKind();
    if (!k) return setError('Choose which master this CSV file contains.');
    setBusy(true);
    try {
      setReport(await importMasters(file, k, true));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const k = effectiveKind();
    if (!file || !k) return;
    setError('');
    setBusy(true);
    try {
      const res = await importMasters(file, k, false);
      if (res.applied) {
        const s = res.summary;
        void qc.invalidateQueries({ queryKey: ['masters'] });
        onApplied(
          `Import applied: ${s.created} created, ${s.updated} updated, ${s.unchanged} unchanged.`,
        );
        reset();
      } else {
        setReport(res);
        setError('Nothing was imported because the file has errors.');
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const rows = report
    ? [...report.rows].sort((a, b) => Number(b.action === 'error') - Number(a.action === 'error'))
    : [];

  return (
    <section className="card" aria-labelledby="imp-h">
      <h2 id="imp-h">Upload a masters file</h2>
      <p className="small muted">
        Import adds new items and updates existing ones by name. It never changes Active/Inactive
        status and never deletes anything.
      </p>
      <div className="row" style={{ alignItems: 'end' }}>
        <label className="f" htmlFor="imp-file">
          File (.xlsx or .csv)
          <input
            key={inputKey}
            id="imp-file"
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setReport(null);
              setError('');
              if (f && isCsv(f) && kind === 'all') setKind('');
            }}
          />
        </label>
        <label className="f" htmlFor="imp-kind">
          Master in this file
          <select
            id="imp-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ExportKind | '')}
          >
            {csv ? (
              <option value="">Choose…</option>
            ) : (
              <option value="">All masters (Excel sheets)</option>
            )}
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void preview()}>
          Check file
        </button>
        {file && (
          <button type="button" className="btn ghost" onClick={reset}>
            Cancel
          </button>
        )}
        {csv && kind && kind !== 'all' && (
          <a className="btn ghost sm" href={templateUrl(kind, 'csv')}>
            Download CSV template for this master
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {report && (
        <div className="panel" aria-label="Import preview" role="group">
          <p role="status">
            <strong>
              {report.summary.created} created, {report.summary.updated} updated,{' '}
              {report.summary.unchanged} unchanged, {report.summary.errors} errors
            </strong>
            {report.truncated && ' (only the first 500 rows are listed; errors come first)'}
          </p>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th scope="col">Sheet</th>
                  <th scope="col">Row</th>
                  <th scope="col">Name</th>
                  <th scope="col">Action</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.sheet}-${r.row}-${i}`}>
                    <td>{r.sheet}</td>
                    <td>{r.row}</td>
                    <td>{r.name}</td>
                    <td>
                      <span className={`pill ${PILL[r.action]}`}>{r.action}</span>
                    </td>
                    <td>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={busy || report.summary.errors > 0}
              onClick={() => void apply()}
            >
              Apply import
            </button>
            <button type="button" className="btn ghost" onClick={reset}>
              Cancel import
            </button>
            {report.summary.errors > 0 && (
              <span className="small muted">Fix the errors in the file and upload it again.</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
