import type { LinkNurseDetail } from '../../../api/types';
import { formatDay, formatWhen } from '../../../lib/format';
import s from './linkNurses.module.css';

/** Ward assignment history and status history of one link nurse (from the detail endpoint). */
export function HistoryPanel({ detail }: { detail: LinkNurseDetail }) {
  return (
    <div className={s.history}>
      <h3>Assignment history</h3>
      {detail.assignments.length === 0 ? (
        <p className="small muted">No ward assignments yet.</p>
      ) : (
        <div className="tw">
          <table aria-label="Assignment history">
            <thead>
              <tr>
                <th scope="col">Ward</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
              </tr>
            </thead>
            <tbody>
              {detail.assignments.map((a, i) => (
                <tr key={`${a.ward.id}-${a.from_date}-${i}`}>
                  <td>{a.ward.name}</td>
                  <td>{formatDay(a.from_date)}</td>
                  <td>
                    {a.to_date ? (
                      formatDay(a.to_date)
                    ) : (
                      <span className="pill p-good">Current</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Status history</h3>
      {detail.status_history.length === 0 ? (
        <p className="small muted">No status changes yet.</p>
      ) : (
        <div className="tw">
          <table aria-label="Status history">
            <thead>
              <tr>
                <th scope="col">Effective</th>
                <th scope="col">Change</th>
                <th scope="col">Reason</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {detail.status_history.map((h, i) => (
                <tr key={`${h.changed_at}-${i}`}>
                  <td>{formatDay(h.effective_date)}</td>
                  <td>
                    {h.old_status} to {h.new_status}
                  </td>
                  <td>{h.reason}</td>
                  <td className="small">
                    {h.changed_by?.full_name ?? 'System'}
                    <span className={s.sub}>{formatWhen(h.changed_at)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
