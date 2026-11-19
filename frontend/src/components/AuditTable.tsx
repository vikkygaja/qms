import type { AuditEntry } from '../api/types';
import { formatWhen } from '../lib/format';

export function AuditTable({ items }: { items: AuditEntry[] }) {
  if (items.length === 0) return <p className="muted small">No audit entries found.</p>;
  return (
    <div className="tw">
      <table>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">By</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td className="small">
                <time dateTime={a.at}>{formatWhen(a.at)}</time>
              </td>
              <td className="small">
                {a.actor ? `${a.actor.full_name} (${a.actor.employee_id})` : 'System'}
              </td>
              <td className="small">
                {a.summary} <span className="pill p-n">{a.action}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
