/**
 * Sign-in page.
 * - username / password (+ authenticator code when MFA is enabled)
 * - password visibility toggle (eye icon from Bootstrap Icons)
 * - after login AppContext sets status='authed' and app.jsx redirects via <LoginRoute>.
 */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AppContext';
import { errorMessage, fieldErrors } from '../../services/api';
import logo from '../../assets/petro_logo.png';

export default function Login() {
  const { login } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', password: '', otp: '' });
  const [needOtp, setNeedOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="login-screen">
      <div className="login-card">
        <img className="login-logo" src={logo} alt="PetroERP: Manage, Automate, Grow" />

        <h1>Sign in</h1>
        <p className="login-card__sub">Enter your details to continue</p>

        <form onSubmit={submit} className="login-form">
          <div className={`field ${fieldErr.username ? 'has-error' : ''}`}>
            <label className="form-label" htmlFor="username">Username <span className="req">*</span></label>
            <input
              id="username" className="form-control" autoFocus autoComplete="username"
              value={form.username} onChange={set('username')} required
            />
            {fieldErr.username && <span className="form-text-error">{fieldErr.username}</span>}
          </div>

          <div className={`field ${fieldErr.password ? 'has-error' : ''}`}>
            <label className="form-label" htmlFor="password">Password <span className="req">*</span></label>
            <div className="input-icon-group has-toggle">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                autoComplete="current-password"
                value={form.password}
                onChange={set('password')}
                required
                style={{ paddingLeft: '0.8rem', paddingRight: '2.6rem' }}
              />
              <button
                type="button"
                className="input-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`} />
              </button>
            </div>
            {fieldErr.password && <span className="form-text-error">{fieldErr.password}</span>}
          </div>

          {needOtp && (
            <div className={`field ${fieldErr.otp ? 'has-error' : ''}`}>
              <label className="form-label" htmlFor="otp">Authenticator code <span className="req">*</span></label>
              <input
                id="otp" className="form-control" inputMode="numeric" autoComplete="one-time-code"
                placeholder="6-digit code" value={form.otp} onChange={set('otp')} required
              />
              {fieldErr.otp && <span className="form-text-error">{fieldErr.otp}</span>}
            </div>
          )}

          {error && <div className="alert alert-danger" role="alert">{error}</div>}

          <button type="submit" className="btn btn-login btn-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          {location.state?.from && (
            <p className="login-note">
              You were redirected from <code>{location.state.from}</code>.
            </p>
          )}

          <p className="login-note">Need an account? Ask a Group Administrator.</p>
        </form>

        <p className="login-foot">© {new Date().getFullYear()} PetroERP</p>
      </div>
    </div>
  );
}