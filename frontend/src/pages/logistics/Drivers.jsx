/**
 * Drivers.
 * - CRUD /drivers/
 * Fields: full_name, id_number, licence_number, licence_category, licence_expiry, phone, employment_status
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const STATUS = ['ACTIVE', 'SUSPENDED', 'TERMINATED'];

export default function Drivers() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.drivers.list({ ...companyParams(), ordering: 'full_name', search, page_size: 500 });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search]);

  useEffect(() => { load(); }, [load]);

  const remove = async (d) => {
    if (!window.confirm(`Delete driver ${d.full_name}?`)) return;
    try { await api.drivers.remove(d.id); notify('Deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Drivers</h1>
          <p className="page-header__subtitle">
            Licenced drivers{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('fleet.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New driver
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Name, licence or ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No drivers</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Name</th><th>ID number</th><th>Licence</th><th>Category</th>
                <th>Expiry</th><th>Phone</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>{d.full_name}</td>
                    <td className="mono">{d.id_number || '—'}</td>
                    <td className="mono">{d.licence_number || '—'}</td>
                    <td>{d.licence_category || '—'}</td>
                    <td className="text-sm">{d.licence_expiry || '—'}</td>
                    <td>{d.phone || '—'}</td>
                    <td><span className={`status ${d.employment_status === 'ACTIVE' ? 'status-active' : d.employment_status === 'SUSPENDED' ? 'status-pending' : 'status-inactive'}`}>{d.employment_status}</span></td>
                    <td className="col-actions">
                      {can('fleet.edit') && (
                        <div className="row-actions">
                          <button className="row-action" title="Edit" onClick={() => setEditing(d)}><i className="bi bi-pencil" /></button>
                          <button className="row-action row-action--danger" title="Delete" onClick={() => remove(d)}><i className="bi bi-trash" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <DriverModal row={editing} companyParams={companyParams}
                     onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function DriverModal({ row, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    full_name: row.full_name || '', id_number: row.id_number || '',
    licence_number: row.licence_number || '', licence_category: row.licence_category || '',
    licence_expiry: row.licence_expiry || '', phone: row.phone || '',
    employment_status: row.employment_status || 'ACTIVE',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.licence_expiry) body.licence_expiry = null;
      isNew ? await api.drivers.create(body) : await api.drivers.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New driver' : `Edit ${row.full_name}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Full name" required err={fieldErr.full_name} span>
                <input className="input" value={form.full_name} onChange={set('full_name')} required />
              </Field>
              <Field label="ID number"><input className="input mono" value={form.id_number} onChange={set('id_number')} /></Field>
              <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Licence number"><input className="input mono" value={form.licence_number} onChange={set('licence_number')} /></Field>
              <Field label="Licence category"><input className="input" value={form.licence_category} onChange={set('licence_category')} /></Field>
              <Field label="Licence expiry"><input type="date" className="input" value={form.licence_expiry} onChange={set('licence_expiry')} /></Field>
              <Field label="Status">
                <select className="select" value={form.employment_status} onChange={set('employment_status')}>
                  {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
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