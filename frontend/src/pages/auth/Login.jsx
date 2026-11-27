import { useState } from 'react';
import { useAuth } from '../../context/AppContext';
import { errorMessage, fieldErrors } from '../../services/api';
import logo from '../../assets/petro_logo.png';

/* Inline icons, so the login page matches the design without an icon font */
const Icon = ({ children, ...props }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
    {children}
  </svg>
);

const stroke = {
  fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round',
};

const UserIcon = () => (
  <Icon>
    <circle cx="12" cy="6.5" r="5" />
    <path d="M3 21c0-4.8 4-8 9-8s9 3.200 9 8v1H3z" />
  </Icon>
);

const LockIcon = () => (
  <Icon>
    <path {...stroke} strokeWidth="2.6" d="M7.5 11V7a4.5 4.5 0 0 1 9 0v4" />
    <rect x="3.5" y="10" width="17" height="13" rx="2.5" />
    <path {...stroke} stroke="#fff" strokeWidth="2.2" d="M12 15v3" />
  </Icon>
);

const ShieldIcon = () => (
  <Icon><path d="M12 1 3 4.500V11c0 5.600 3.800 10.300 9 12 5.200-1.700 9-6.400 9-12V4.500z" /></Icon>
);

const EyeIcon = ({ off }) => (
  <Icon {...stroke} strokeWidth="1.900">
    <path d="M1.500 12S5.500 5 12 5s10.500 7 10.500 7-4 7-10.500 7S1.500 12 1.500 12z" />
    <circle cx="12" cy="12" r="3.200" />
    {off && <path d="M4 3l16 18" />}
  </Icon>
);

const SignInIcon = () => (
  <Icon {...stroke} strokeWidth="2.600">
    <path d="M14 3h4.500A2.500 2.500 0 0 1 21 5.500v13a2.500 2.500 0 0 1-2.500 2.500H14" />
    <path d="M2.500 12H14M9.500 7l5 5-5 5" />
  </Icon>
);

export default function Login() {
  const { login } = useAuth();
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

  const fieldClass = (k) => `login-field${fieldErr[k] ? ' has-error' : ''}`;

  return (
    <div className="login-screen">
      <div className="login-wrap">
        <div className="login-card">
          <img className="login-logo" src={logo} alt="PetroERP: Plan, Manage, Grow" />

          <h1>Welcome Back</h1>
          <p className="login-card__sub">Sign in to your PetroERP account</p>

          <form onSubmit={submit} className="login-form">
            <div className={fieldClass('username')}>
              <label className="login-label" htmlFor="username">
                <UserIcon />
                <span>Username <span className="login-req">*</span></span>
              </label>
              <input
                id="username"
                className="login-input"
                placeholder="Enter your username"
                autoFocus
                autoComplete="username"
                value={form.username}
                onChange={set('username')}
                required
              />
              {fieldErr.username && <span className="form-text-error">{fieldErr.username}</span>}
            </div>

            <div className={fieldClass('password')}>
              <label className="login-label" htmlFor="password">
                <LockIcon />
                <span>Password <span className="login-req">*</span></span>
              </label>
              <div className="login-input-wrap login-input-wrap--password">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="login-input"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={set('password')}
                  required
                />
                <button
                  type="button"
                  className="login-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
              {fieldErr.password && <span className="form-text-error">{fieldErr.password}</span>}
            </div>

            {needOtp && (
              <div className={fieldClass('otp')}>
                <label className="login-label" htmlFor="otp">
                  <ShieldIcon />
                  <span>Authenticator code <span className="login-req">*</span></span>
                </label>
                <input
                  id="otp"
                  className="login-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  value={form.otp}
                  onChange={set('otp')}
                  required
                />
                {fieldErr.otp && <span className="form-text-error">{fieldErr.otp}</span>}
              </div>
            )}

            {error && <div className="alert alert-danger" role="alert">{error}</div>}

            <button type="submit" className="login-btn" disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner spinner--sm login-spinner" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                <>
                  <SignInIcon />
                  Sign In
                </>
              )}
            </button>

            <p className="login-note"><span>Need an account? Contact your administrator.</span></p>
          </form>
        </div>

        <p className="login-foot">© {new Date().getFullYear()} PetroERP. All rights reserved.</p>
      </div>
    </div>
  );
}