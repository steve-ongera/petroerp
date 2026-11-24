/**
 * Sign-in page.
 * - username / password (+ authenticator code when MFA is enabled)
 * - after login AppContext sets status='authed' and app.jsx redirects via <LoginRoute>.
 */
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AppContext';
import { errorMessage, fieldErrors } from '../../services/api';

export default function Login() {
  const { login } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', password: '', otp: '' });
  const [needOtp, setNeedOtp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setFieldErr({});
    try {
      await login(form.username.trim(), form.password, form.otp.trim() || undefined);
      // redirect handled by <LoginRoute> using location.state.from
    } catch (err) {
      const msg = errorMessage(err);
      if (/otp|authenticator/i.test(msg)) setNeedOtp(true);
      setFieldErr(fieldErrors(err));
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen d-flex items-center justify-center" style={{ minHeight: '100vh', padding: 24 }}>
      <form onSubmit={submit} className="card" style={{ width: 380, padding: 28 }}>
        <h1 className="h2 mb-1">PetroERP</h1>
        <p className="text-muted mb-4">Sign in to continue</p>

        <div className="form">
          <div className={`field ${fieldErr.username ? 'has-error' : ''}`}>
            <label className="label label--required" htmlFor="username">Username</label>
            <input
              id="username" className="input" autoFocus autoComplete="username"
              value={form.username} onChange={set('username')} required
            />
            {fieldErr.username && <span className="field-error">{fieldErr.username}</span>}
          </div>

          <div className={`field ${fieldErr.password ? 'has-error' : ''}`}>
            <label className="label label--required" htmlFor="password">Password</label>
            <input
              id="password" type="password" className="input" autoComplete="current-password"
              value={form.password} onChange={set('password')} required
            />
            {fieldErr.password && <span className="field-error">{fieldErr.password}</span>}
          </div>

          {needOtp && (
            <div className={`field ${fieldErr.otp ? 'has-error' : ''}`}>
              <label className="label label--required" htmlFor="otp">Authenticator code</label>
              <input
                id="otp" className="input" inputMode="numeric" autoComplete="one-time-code"
                placeholder="6-digit code" value={form.otp} onChange={set('otp')} required
              />
              {fieldErr.otp && <span className="field-error">{fieldErr.otp}</span>}
            </div>
          )}

          {error && <p className="field-error" role="alert">{error}</p>}

          <button type="submit" className="btn btn-success btn-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          {location.state?.from && (
            <p className="text-sm text-muted text-center mt-2">
              You were redirected from <code>{location.state.from}</code>.
            </p>
          )}

          <p className="text-sm text-muted text-center mt-2">
            Need an account? Ask a Group Administrator.
          </p>
        </div>
      </form>
    </div>
  );
}