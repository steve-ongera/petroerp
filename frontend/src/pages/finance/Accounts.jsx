/**
 * Chart of accounts (per legal entity).
 * - CRUD /accounts/   (company scoped)
 * Fields: code, name, account_type, subtype, group_code, parent, is_postable, is_intercompany, is_active
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const SUBTYPES = ['', 'CASH', 'BANK', 'MPESA', 'AR', 'AP', 'INVENTORY', 'TRANSIT', 'COGS', 'OPEX', 'IC_RECEIVABLE', 'IC_PAYABLE'];

export default function Accounts() {
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.accounts.list({
        ...companyParams(), ordering: 'code',
        ...(type ? { account_type: type } : {}),
        ...(search ? { search } : {}),
        page_size: 1000,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, type, search]);

  useEffect(() => { load(); }, [load]);

  const remove = async (a) => {
    if (!window.confirm(`Delete account ${a.code}?`)) return;
    try { await api.accounts.remove(a.id); notify('Account deleted.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Chart of accounts</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'} · {rows.length} account{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <i className="bi bi-plus-lg" /> New account
          </button>
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {error ? (
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No accounts</div><div>Create the chart of accounts first.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Code</th><th>Name</th><th>Type</th><th>Subtype</th><th>Group</th>
                <th>Postable</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{a.code}</td>
                    <td>{a.name}</td>
                    <td><span className="badge">{a.account_type}</span></td>
                    <td>{a.subtype || '—'}</td>
                    <td className="mono">{a.group_code || '—'}</td>
                    <td>
                      {a.is_postable
                        ? <span className="badge badge--success">Yes</span>
                        : <span className="badge">No</span>}
                    </td>
                    <td><span className={`status ${a.is_active ? 'status-active' : 'status-inactive'}`}>{a.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="row-action" title="Edit" onClick={() => setEditing(a)}><i className="bi bi-pencil" /></button>
                        <button className="row-action row-action--danger" title="Delete" onClick={() => remove(a)}><i className="bi bi-trash" /></button>
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
        <AccountModal
          row={editing}
          accounts={rows}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Account saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function AccountModal({ row, accounts, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '',
    account_type: row.account_type || 'ASSET', subtype: row.subtype || '',
    group_code: row.group_code || '', parent: row.parent || '',
    is_postable: row.is_postable ?? true, is_intercompany: row.is_intercompany ?? false,
    is_active: row.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.parent) delete body.parent;
      isNew ? await api.accounts.create(body) : await api.accounts.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  const parents = accounts.filter((a) => !row.id || a.id !== row.id);

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New account' : `Edit ${row.code}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Code" required err={fieldErr.code}>
                <input className="input mono" value={form.code} onChange={set('code')} required disabled={!isNew} />
              </Field>
              <Field label="Name" required err={fieldErr.name}>
                <input className="input" value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Type" required>
                <select className="select" value={form.account_type} onChange={set('account_type')}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Subtype">
                <input className="input" list="subtypes" value={form.subtype} onChange={set('subtype')} />
                <datalist id="subtypes">{SUBTYPES.map((s) => s && <option key={s} value={s} />)}</datalist>
              </Field>
              <Field label="Group code">
                <input className="input mono" value={form.group_code} onChange={set('group_code')} placeholder="Consolidated chart" />
              </Field>
              <Field label="Parent account">
                <select className="select" value={form.parent} onChange={set('parent')}>
                  <option value="">— none —</option>
                  {parents.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </select>
              </Field>
              <Field label="Postable">
                <label className="check"><input type="checkbox" checked={!!form.is_postable} onChange={set('is_postable')} /> Can be posted to</label>
              </Field>
              <Field label="Intercompany">
                <label className="check"><input type="checkbox" checked={!!form.is_intercompany} onChange={set('is_intercompany')} /> Intercompany account</label>
              </Field>
              <Field label="Active" span>
                <label className="check"><input type="checkbox" checked={!!form.is_active} onChange={set('is_active')} /> Active</label>
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