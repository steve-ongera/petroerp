/**
 * Users.
 * - /users/   crud (plain + create/update/patch/remove)
 * - UserSerializer: password write-only, companies M2M, role FK.
 * - Group admin only (AdminUsers route guard requires admin.view);
 *   server rejects non-group-admin changes it doesn't like.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const EMPTY = {
  username: '', email: '', first_name: '', last_name: '', phone: '',
  password: '', role: '', companies: [], is_active: true,
};

export default function Users() {
  const { user: me } = useAuth();
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [u, r, c] = await Promise.all([
        api.users.list({ ordering: 'username', search, page_size: 500 }),
        api.roles.listAll(),
        api.companies.listAll(),
      ]);
      setRows(u?.results || u || []);
      setRoles(r); setCompanies(c);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const remove = async (u) => {
    if (u.id === me?.id) return;
    if (!window.confirm(`Delete user ${u.username}?`)) return;
    try { await api.users.remove(u.id); notify('User deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Users</h1>
          <p className="page-header__subtitle">Accounts, roles and legal-entity access</p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>
            <i className="bi bi-plus-lg" /> New user
          </button>
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search username or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{rows.length} user{rows.length === 1 ? '' : 's'}</span>
        </div>

        {error ? (
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        ) : !rows.length && !loading ? (
          <div className="table-empty">
            <div className="table-empty__title">No users</div>
            <div>Create the first user and assign them a role and legal entities.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Username</th><th>Name</th><th>Role</th><th>Companies</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.username}{u.id === me?.id && <span className="cell-sub">you</span>}</td>
                    <td>
                      <span className="cell-main">{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</span>
                      {u.email && <span className="cell-sub">{u.email}</span>}
                    </td>
                    <td>{u.role_name || u.role || '—'}</td>
                    <td className="text-sm">{Array.isArray(u.companies) ? u.companies.length : (u.companies || []).length} assigned</td>
                    <td><span className={`status ${u.is_active ? 'status-active' : 'status-inactive'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="row-action" title="Edit" onClick={() => setEditing({ ...u, password: '', companies: (u.companies || []).map((c) => typeof c === 'object' ? c.id : c) })}><i className="bi bi-pencil" /></button>
                        {u.id !== me?.id && (
                          <button className="row-action row-action--danger" title="Delete" onClick={() => remove(u)}><i className="bi bi-trash" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <UserModal
          row={editing}
          roles={roles}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('User saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function UserModal({ row, roles, companies, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    username: row.username || '', email: row.email || '',
    first_name: row.first_name || '', last_name: row.last_name || '',
    phone: row.phone || '', password: '', role: row.role || '',
    companies: row.companies || [], is_active: row.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const toggleCompany = (id) => {
    setForm((f) => {
      const cur = new Set(f.companies);
      cur.has(id) ? cur.delete(id) : cur.add(id);
      return { ...f, companies: Array.from(cur) };
    });
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      if (!body.password) delete body.password;
      if (!body.role) delete body.role;
      if (isNew) await api.users.create(body);
      else await api.users.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New user' : `Edit ${row.username}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Username" required err={fieldErr.username}>
                <input className="input mono" value={form.username} onChange={set('username')} required disabled={!isNew} />
              </Field>
              <Field label="Email" err={fieldErr.email}>
                <input type="email" className="input" value={form.email} onChange={set('email')} />
              </Field>
              <Field label="First name"><input className="input" value={form.first_name} onChange={set('first_name')} /></Field>
              <Field label="Last name"><input className="input" value={form.last_name} onChange={set('last_name')} /></Field>
              <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Role" err={fieldErr.role}>
                <select className="select" value={form.role} onChange={set('role')}>
                  <option value="">— none —</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
                </select>
              </Field>
              <Field label={isNew ? 'Password' : 'Reset password'} err={fieldErr.password} span>
                <input type="password" className="input" autoComplete="new-password" value={form.password} onChange={set('password')}
                       placeholder={isNew ? 'At least 10 characters' : 'Leave blank to keep the current password'} />
              </Field>
              <Field label="Legal entities" span>
                <div className="check-list" style={{ maxHeight: 200, overflow: 'auto', padding: 4, border: '1px solid var(--border)', borderRadius: 4 }}>
                  {companies.map((c) => (
                    <label key={c.id} className="check">
                      <input type="checkbox"
                             checked={form.companies.includes(c.id) || form.companies.some((x) => String(x) === String(c.id))}
                             onChange={() => toggleCompany(c.id)} />
                      {c.code} · {c.name}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Active" span>
                <label className="check"><input type="checkbox" checked={!!form.is_active} onChange={set('is_active')} /> Account enabled</label>
              </Field>
            </div>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, err, span, children }) {
  return (
    <div className={`field ${span ? 'span-all' : ''} ${err ? 'has-error' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
      {err && <span className="field-error">{err}</span>}
    </div>
  );
}