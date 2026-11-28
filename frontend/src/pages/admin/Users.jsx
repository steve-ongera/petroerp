/**
 * Users.
 * - /users/   crud (plain + create/update/patch/remove)
 * - UserSerializer: password write-only, companies M2M, role FK.
 * - Group admin only (route guard requires admin.view); the server rejects anything it doesn't allow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

export default function Users() {
  const { user: me } = useAuth();
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [u, r, c] = await Promise.all([
        api.users.list({ ordering: 'username', ...(search ? { search } : {}), page_size: 500 }),
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

  const filtered = useMemo(() => rows.filter((u) => (
    !statusFilter || (statusFilter === 'active' ? u.is_active : !u.is_active)
  )), [rows, statusFilter]);

  const hasActiveFilters = !!(search || statusFilter);
  const clearFilters = () => { setSearch(''); setStatusFilter(''); };
  const { pageRows, paginationProps } = usePagination(filtered);

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Users</h1>
            <p className="page-subtitle">Accounts, roles and legal-entity access</p>
          </div>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <i className="bi bi-plus-lg"></i>
            New user
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      {/* ---------- One white card: search, filters, table, pagination ---------- */}
      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by username or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search users"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasActiveFilters && (
            <button className="btn btn-secondary" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="chip-row">
            {search && (
              <span className="filter-chip">
                Search: "{search}"
                <button onClick={() => setSearch('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {statusFilter && (
              <span className="filter-chip">
                Status: {statusFilter === 'active' ? 'Active' : 'Inactive'}
                <button onClick={() => setStatusFilter('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            User List
          </span>
          <span className="chart-card__subtitle">
            {filtered.length} user{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={6} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-people"></i>
            <h6>{hasActiveFilters ? 'No users match your search' : 'No users yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New user' to create the first account"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th className="text-right">Companies</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '7rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((u) => (
                    <tr key={u.id}>
                      <td className="cell-mono text-brand fw-600">
                        {u.username}
                        {u.id === me?.id && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>you</span>}
                      </td>
                      <td className="cell-name">
                        {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                        {u.email && <div className="text-muted-soft" style={{ fontSize: '0.8rem' }}>{u.email}</div>}
                      </td>
                      <td>{u.role_name || u.role || '—'}</td>
                      <td className="cell-num">{(u.companies || []).length}</td>
                      <td>
                        <span className={`status-pill ${u.is_active ? 'status-pill--success' : 'status-pill--neutral'}`}>
                          {u.is_active ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn btn-icon" title="Edit" aria-label="Edit"
                            onClick={() => setEditing({ ...u, companies: (u.companies || []).map((c) => (typeof c === 'object' ? c.id : c)) })}
                          >
                            <i className="bi bi-pencil"></i>
                          </button>
                          {u.id !== me?.id && (
                            <button className="btn btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(u)}>
                              <i className="bi bi-trash"></i>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && filtered.length > 0 && <Pagination {...paginationProps} />}
      </section>

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

  const hasCompany = (id) => form.companies.some((x) => String(x) === String(id));
  const toggleCompany = (id) => {
    setForm((f) => {
      const has = f.companies.some((x) => String(x) === String(id));
      return { ...f, companies: has ? f.companies.filter((x) => String(x) !== String(id)) : [...f.companies, id] };
    });
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      if (!body.password) delete body.password;
      if (!body.role) delete body.role;
      isNew ? await api.users.create(body) : await api.users.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New user' : `Edit ${row.username}`}
      subtitle="Account, role and legal-entity access"
      icon="bi-person-gear"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="userForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="userForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-person-vcard" aria-hidden="true"></i>Account Details</h6>
        <div className="form-grid">
          <Field label="Username" required err={fieldErr.username}>
            <input className="form-control font-mono" value={form.username} onChange={set('username')} required disabled={!isNew} />
          </Field>
          <Field label="Email" err={fieldErr.email}>
            <input type="email" className="form-control" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="First name">
            <input className="form-control" value={form.first_name} onChange={set('first_name')} />
          </Field>
          <Field label="Last name">
            <input className="form-control" value={form.last_name} onChange={set('last_name')} />
          </Field>
          <Field label="Phone">
            <input className="form-control" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Role" err={fieldErr.role}>
            <select className="form-select" value={form.role} onChange={set('role')}>
              <option value="">� none �</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
            </select>
          </Field>
          <Field label={isNew ? 'Password' : 'Reset password'} err={fieldErr.password} span>
            <input
              type="password" className="form-control" autoComplete="new-password"
              value={form.password} onChange={set('password')}
              placeholder={isNew ? 'At least 10 characters' : 'Leave blank to keep the current password'}
            />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-building" aria-hidden="true"></i>Access</h6>
        <div className="form-grid">
          <Field label="Legal entities" span>
            <div style={{ maxHeight: 200, overflow: 'auto', padding: 8, border: '1px solid var(--border-color)', borderRadius: 6 }}>
              {companies.length === 0 && <span className="text-muted-soft">No legal entities yet.</span>}
              {companies.map((c) => (
                <div className="form-check" key={c.id}>
                  <input
                    className="form-check-input" type="checkbox" id={`co-${c.id}`}
                    checked={hasCompany(c.id)} onChange={() => toggleCompany(c.id)}
                  />
                  <label className="form-check-label" htmlFor={`co-${c.id}`}>{c.code} · {c.name}</label>
                </div>
              ))}
            </div>
          </Field>
          <Field label="Status" span>
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="user-active" checked={!!form.is_active} onChange={set('is_active')} />
              <label className="form-check-label" htmlFor="user-active">Account enabled</label>
            </div>
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}