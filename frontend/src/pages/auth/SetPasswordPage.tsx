import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import styles from './Auth.module.css';

const POLICY = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

export function SetPasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!current) return setErrors(['Enter your temporary password.']);
    if (!POLICY.test(next)) {
      return setErrors(['Use at least 8 characters with letters and numbers.']);
    }
    if (next !== confirm) return setErrors(["The two passwords don't match."]);
    setBusy(true);
    setErrors([]);
    try {
      await changePassword(current, next);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.details.map((d) => d.message);
        setErrors(fields.length ? fields : [err.message]);
      } else {
        setErrors(['Could not save the password. Try again.']);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <form className="card" onSubmit={submit} noValidate>
        <h1>Set your new password</h1>
        <p className="muted small">
          Welcome, {user?.full_name}. This is your first sign-in, so replace the temporary password.
        </p>
        <label className="f" htmlFor="pw-current">
          Temporary password
          <input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="f" htmlFor="pw-new">
          New password
          <input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            aria-describedby="pw-rule"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label className="f" htmlFor="pw-confirm">
          Confirm new password
          <input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <p id="pw-rule" className="small muted">
          At least 8 characters, with letters and numbers.
        </p>
        <div role="alert">
          {errors.map((m) => (
            <p key={m} className="err">
              {m}
            </p>
          ))}
        </div>
        <div className="row">
          <button type="submit" className="btn" disabled={busy}>
            Save and continue
          </button>
          <button type="button" className="btn ghost" onClick={() => void logout()}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
