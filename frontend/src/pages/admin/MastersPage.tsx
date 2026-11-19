import { exportUrl, templateUrl } from '../../api/masters';
import { useToast } from '../../lib/useToast';
import { KpiCard } from './KpiCard';
import { MasterList } from './MasterList';
import { MastersImport } from './MastersImport';

export function MastersPage() {
  const toast = useToast();
  return (
    <>
      <section className="card">
        <h1>Masters</h1>
        <p className="small muted">
          Shared lists used by every QMS module. No delete: inactive items disappear from entry
          screens but stay in past records.
        </p>
        <div className="row">
          <a className="btn ghost sm" href={exportUrl('all', 'xlsx')}>
            Download all (Excel)
          </a>
          <a className="btn ghost sm" href={templateUrl('all', 'xlsx')}>
            Download template (Excel)
          </a>
        </div>
      </section>
      <MastersImport onApplied={toast.show} />
      <div className="g2">
        <MasterList kind="wards" onChanged={toast.show} />
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <MasterList kind="departments" onChanged={toast.show} />
          <MasterList kind="staff-categories" onChanged={toast.show} />
          <KpiCard onSaved={toast.show} />
        </div>
      </div>
      {toast.node}
    </>
  );
}
