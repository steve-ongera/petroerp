/**
 * Company structure: branches + departments.
 * - /branches/    crud   (Coded master record, company scoped)
 * - /departments/ crud   (Coded, has optional branch FK)
 * Two tabs; everything scoped to the active legal entity via companyParams().
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const TABS = [
  { key: 'branches', label: 'Branches' },
  { key: 'departments', label: 'Departments' },
];

export default function Structure() {
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [tab, setTab] = useState('branches');
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [b, d] = await Promise.all([
        api.branches.listAll({ ...companyParams() }),
        api.departments.listAll({ ...companyParams() }),
      ]);
      setBranches(b); setDepartments(d);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const remove = async (resource, row) => {
    if (!window.confirm(`Delete ${row.code}?`)) return;
    try { await resource.remove(row.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Structure</h1>
          <p className="page-header__subtitle">
            Branches and departments{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({ kind: tab, row: {} })}>
            <i className="bi bi-plus-lg" /> New {tab === 'branches' ? 'branch' : 'department'}
          </button>
        </div>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            <span className="tab__count">{(t.key === 'branches' ? branches : departments).length}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="card"><div className="card__body">
          <p className="field-error" role="alert">{error}</p>
          <button className="btn mt-2" onClick={load}>Try again</button>
        </div></div>
      ) : loading ? (
        <div className="state-screen">Loading…</div>
      ) : tab === 'branches' ? (
        <SimpleTable
          rows={branches}
          columns={[
            { key: 'code', label: 'Code', mono: true },
            { key: 'name', label: 'Name' },
            { key: 'address', label: 'Address' },
            { key: 'is_active', label: 'Status', render: (r) => (
              <span className={`status ${r.is_active ? 'status-active' : 'status-inactive'}`}>{r.is_active ? 'Active' : 'Inactive'}</span>
            ) },
          ]}
          onEdit={(r) => setEditing({ kind: 'branches', row: r })}
          onDelete={(r) => remove(api.branches, r)}
        />
      ) : (
        <SimpleTable
          rows={departments}
          columns={[
            { key: 'code', label: 'Code', mono: true },
            { key: 'name', label: 'Name' },
            { key: 'branch_label', label: 'Branch' },
          ]}
          onEdit={(r) => setEditing({ kind: 'departments', row: r })}
          onDelete={(r) => remove(api.departments, r)}
        />
      )}

      {editing && (
        <StructureModal
          kind={editing.kind}
          row={editing.row}
          branches={branches}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function SimpleTable({ rows, columns, onEdit, onDelete }) {
  return (
    <div className="table-card">
      {!rows.length ? (
        <div className="table-empty">
          <div className="table-empty__title">Nothing yet</div>
          <div>Click "New" to add the first record.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              {columns.map((c) => <th key={c.key}>{c.label}</th>)}
              <th className="col-actions" />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.mono ? 'mono' : ''}>
                      {c.render ? c.render(r) : (r[c.key] || '—')}
                    </td>
                  ))}
                  <td className="col-actions">
                    <div className="row-actions">
                      <button className="row-action" onClick={() => onEdit(r)} title="Edit"><i className="bi bi-pencil" /></button>
                      <button className="row-action row-action--danger" onClick={() => onDelete(r)} title="Delete"><i className="bi bi-trash" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StructureModal({ kind, row, branches, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', address: row.address || '',
    branch: row.branch || '', is_active: row.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (kind === 'branches') {
        delete body.branch;
        isNew ? await api.branches.create(body) : await api.branches.update(row.id, body);
      } else {
        if (!body.branch) delete body.branch;
        isNew ? await api.departments.create(body) : await api.departments.update(row.id, body);
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err)); setFieldErr(fieldErrors(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <div>
            <h2 className="modal__title">{isNew ? 'New' : 'Edit'} {kind === 'branches' ? 'branch' : 'department'}</h2>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <Field label="Code" required err={fieldErr.code}>
                <input className="input mono" value={form.code} onChange={set('code')} required disabled={!isNew}
                       placeholder="Auto-generated if left blank" />
              </Field>
              <Field label="Name" required err={fieldErr.name}>
                <input className="input" value={form.name} onChange={set('name')} required />
              </Field>
              {kind === 'branches' ? (
                <Field label="Address"><textarea className="textarea" rows={2} value={form.address} onChange={set('address')} /></Field>
              ) : (
                <Field label="Branch">
                  <select className="select" value={form.branch} onChange={set('branch')}>
                    <option value="">— none —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
                  </select>
                </Field>
              )}
              {kind === 'branches' && (
                <Field label="Active">
                  <label className="check"><input type="checkbox" checked={!!form.is_active} onChange={set('is_active')} /> Active</label>
                </Field>
              )}
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

function Field({ label, required, err, children }) {
  return (
    <div className={`field ${err ? 'has-error' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
      {err && <span className="field-error">{err}</span>}
    </div>
  );
}