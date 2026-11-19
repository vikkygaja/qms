import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import styles from './Auth.module.css';

export function LoginPage() {
  const { login } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!employeeId.trim() || !password) {
      setError('Enter your employee ID and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(employeeId.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed. Try again.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div>
        <h1>QMS · Quality Management System</h1>
        <p className="muted">Sri Narayani Hospital &amp; Research Centre</p>
      </div>
      <form className="card" onSubmit={submit} noValidate>
        <h2>Sign in</h2>
        <label className="f" htmlFor="login-emp">
          Employee ID
          <input
            id="login-emp"
            type="text"
            autoComplete="username"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          />
        </label>
        <label className="f" htmlFor="login-pw">
          Password
          <input
            id="login-pw"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <p role="alert" className="err">
          {error}
        </p>
        <div>
          <button type="submit" className="btn" disabled={busy}>
            Sign in
          </button>
        </div>
      </form>
    </div>
  );
}
