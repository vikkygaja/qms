import { useState } from 'react';

export interface Secret {
  name: string;
  employeeId: string;
  password: string;
  /** "created" (new login) or "reset" (password reset). */
  kind: 'created' | 'reset';
}

/** One-time temporary password. Lives in component state only and goes away on Done or navigation. */
export function SecretBox({ secret, onDone }: { secret: Secret; onDone: () => void }) {
  const [note, setNote] = useState('');

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `Username: ${secret.employeeId}  Temporary password: ${secret.password}`,
      );
      setNote('Copied.');
    } catch {
      setNote('Copy not allowed here; note it down.');
    }
  }

  return (
    <div className="secret" role="group" aria-label="Temporary password">
      <strong>
        {secret.kind === 'created'
          ? `Login created for ${secret.name}`
          : `Password reset for ${secret.name}`}
      </strong>
      <span>
        Username: <code>{secret.employeeId}</code> · Temporary password:{' '}
        <code>{secret.password}</code>
      </span>
      <span className="small">Shown once. The user must set a new password at first login.</span>
      <div className="row">
        <button type="button" className="btn sm" onClick={() => void copy()}>
          Copy
        </button>
        <button type="button" className="btn ghost sm" onClick={onDone}>
          Done
        </button>
        <span role="status" className="small muted">
          {note}
        </span>
      </div>
    </div>
  );
}
