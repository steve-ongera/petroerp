/**
 * My profile.
 * - shows account, role, permissions, companies
 * - change password (PATCH /users/:id/ with password)
 * - enable / disable MFA (auth.mfaSetup / mfaEnable)
 */
import { useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const { notify } = useApp();
  const [tab, setTab] = useState('account');
  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">My profile</h1>
          <p className="page-header__subtitle">Account, security and legal-entity access</p>
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'account' ? 'active' : ''}`} onClick={() => setTab('account')}>Account</button>
        <button className={`tab ${tab === 'security' ? 'active' : ''}`} onClick={() => setTab('security')}>Security</button>
        <button className={`tab ${tab === 'access' ? 'active' : ''}`} onClick={() => setTab('access')}>Access</button>
      </div>

      {tab === 'account' && <AccountTab user={user} refreshUser={refreshUser} notify={notify} />}
      {tab === 'security' && <SecurityTab user={user} refreshUser={refreshUser} notify={notify} />}
      {tab === 'access' && <AccessTab user={user} />}
    </div>
  );
}

/* ------------------------------------------------------------------ account */
function AccountTab({ user, refreshUser, notify }) {
  const [form, setForm] = useState({
    first_name: user?.first_name || '', last_name: user?.last_name || '',
    email: user?.email || '', phone: user?.phone || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({
      first_name: user?.first_name || '', last_name: user?.last_name || '',
      email: user?.email || '', phone: user?.phone || '',
    });
  }, [user]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.users.patch(user.id, form);
      await refreshUser();
      notify('Profile updated.', 'success');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card__body">
        <form onSubmit={save} className="form-grid">
          <div className="field">
            <label className="label">First name</label>
            <input className="input" value={form.first_name} onChange={set('first_name')} />
          </div>
          <div className="field">
            <label className="label">Last name</label>
            <input className="input" value={form.last_name} onChange={set('last_name')} />
          </div>
          <div className="field">
            <label className="label">Email</label>
            <input type="email" className="input" value={form.email} onChange={set('email')} />
          </div>
          <div className="field">
            <label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={set('phone')} />
          </div>
          <div className="field col-span-2">
            <label className="label">Username</label>
            <input className="input" value={user?.username || ''} readOnly />
            <span className="field-hint">Usernames are managed by an administrator.</span>
          </div>
          {error && <p className="field-error col-span-2" role="alert">{error}</p>}
          <div className="form-actions col-span-2">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ security */
function SecurityTab({ user, refreshUser, notify }) {
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwErr, setPwErr] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [mfa, setMfa] = useState({ secret: '', otpauth_uri: '', otp: '', step: 'idle' });
  const [mfaErr, setMfaErr] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);

  const changePassword = async (e) => {
    e.preventDefault();
    setPwErr('');
    if (pw.next !== pw.confirm) return setPwErr('Passwords do not match.');
    if (pw.next.length < 10) return setPwErr('Password must be at least 10 characters.');
    setPwBusy(true);
    try {
      await api.users.patch(user.id, { password: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      notify('Password changed.', 'success');
    } catch (err) {
      setPwErr(errorMessage(err));
    } finally {
      setPwBusy(false);
    }
  };

  const startMfa = async () => {
    setMfaErr(''); setMfaBusy(true);
    try {
      const res = await api.auth.mfaSetup();
      setMfa({ secret: res.secret, otpauth_uri: res.otpauth_uri, otp: '', step: 'confirm' });
    } catch (err) {
      setMfaErr(errorMessage(err));
    } finally {
      setMfaBusy(false);
    }
  };

  const confirmMfa = async (e) => {
    e.preventDefault();
    setMfaErr(''); setMfaBusy(true);
    try {
      await api.auth.mfaEnable(mfa.otp);
      await refreshUser();
      setMfa({ secret: '', otpauth_uri: '', otp: '', step: 'idle' });
      notify('Two-factor authentication enabled.', 'success');
    } catch (err) {
      setMfaErr(errorMessage(err));
    } finally {
      setMfaBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="card__header"><h2 className="card__title">Change password</h2></div>
        <div className="card__body">
          <form onSubmit={changePassword} className="form" style={{ maxWidth: 420 }}>
            <div className="field">
              <label className="label label--required">New password</label>
              <input type="password" className="input" autoComplete="new-password"
                     value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
              <span className="field-hint">At least 10 characters.</span>
            </div>
            <div className="field">
              <label className="label label--required">Confirm new password</label>
              <input type="password" className="input" autoComplete="new-password"
                     value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
            </div>
            {pwErr && <p className="field-error" role="alert">{pwErr}</p>}
            <div className="form-actions">
              <button className="btn btn-primary" disabled={pwBusy}>{pwBusy ? 'Saving…' : 'Change password'}</button>
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">Two-factor authentication</h2>
          <span className={`badge ${user?.mfa_enabled ? 'badge--success' : 'badge--neutral'}`}>
            {user?.mfa_enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div className="card__body">
          {user?.mfa_enabled ? (
            <p className="text-muted">Your account is protected by an authenticator app.</p>
          ) : mfa.step === 'idle' ? (
            <>
              <p className="text-muted mb-3">
                Add a second factor to your sign-in. You will need an authenticator app (Google Authenticator, Authy, 1Password…).
              </p>
              <button className="btn btn-primary" onClick={startMfa} disabled={mfaBusy}>
                {mfaBusy ? 'Preparing…' : 'Enable 2FA'}
              </button>
            </>
          ) : (
            <form onSubmit={confirmMfa} className="form" style={{ maxWidth: 480 }}>
              <p className="text-muted">Scan this secret into your authenticator app, then enter a code below.</p>
              <div className="field">
                <label className="label">Secret</label>
                <input className="input mono" value={mfa.secret} readOnly />
              </div>
              <div className="field">
                <label className="label">Provisioning URI</label>
                <input className="input mono" value={mfa.otpauth_uri} readOnly />
              </div>
              <div className="field">
                <label className="label label--required">Authenticator code</label>
                <input className="input" inputMode="numeric" maxLength={6}
                       value={mfa.otp} onChange={(e) => setMfa({ ...mfa, otp: e.target.value })} required />
              </div>
              {mfaErr && <p className="field-error" role="alert">{mfaErr}</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setMfa({ secret: '', otpauth_uri: '', otp: '', step: 'idle' })}>Cancel</button>
                <button className="btn btn-primary" disabled={mfaBusy}>{mfaBusy ? 'Confirming…' : 'Confirm and enable'}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ access */
function AccessTab({ user }) {
  return (
    <div className="stack">
      <div className="card">
        <div className="card__header"><h2 className="card__title">Role</h2></div>
        <div className="card__body">
          <div className="kv">
            <div className="kv__item">
              <div className="kv__label">Role</div>
              <div className="kv__value">{user?.role_name || user?.role || '—'}</div>
            </div>
            <div className="kv__item">
              <div className="kv__label">Username</div>
              <div className="kv__value mono">{user?.username}</div>
            </div>
            <div className="kv__item">
              <div className="kv__label">Email</div>
              <div className="kv__value">{user?.email || '—'}</div>
            </div>
            <div className="kv__item">
              <div className="kv__label">2FA</div>
              <div className="kv__value">{user?.mfa_enabled ? 'Enabled' : 'Disabled'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header"><h2 className="card__title">Legal entities</h2></div>
        <div className="card__body">
          {!user?.companies?.length ? (
            <div className="table-empty">
              <div className="table-empty__title">No legal entities</div>
              <div>Ask a Group Administrator to grant access.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Code</th><th>Name</th><th>Country</th><th>Currency</th></tr>
                </thead>
                <tbody>
                  {user.companies.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.code}</td>
                      <td>{c.name}</td>
                      <td>{c.country}</td>
                      <td>{c.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__header"><h2 className="card__title">Permissions ({user?.permissions?.length || 0})</h2></div>
        <div className="card__body">
          {!user?.permissions?.length ? (
            <p className="text-muted">No permissions assigned.</p>
          ) : (
            <div className="chip-list">
              {user.permissions.map((p) => (
                <span key={p} className="chip mono">{p}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}