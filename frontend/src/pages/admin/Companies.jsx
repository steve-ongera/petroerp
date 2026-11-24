/**
 * Legal entities (companies).
 * - GET/POST/PATCH/DELETE /companies/   (crud('companies'))
 * - Only the Group Administrator can create (enforced server-side).
 * - Each company is the "legal entity" everything else is scoped to.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const EMPTY = {
  code: '', name: '', country: 'KE', functional_currency: '',
  tax_pin: '', registration_number: '', address: '', phone: '', email: '',
  inventory_valuation: 'WAVG', min_margin_pct: '', match_tolerance_pct: '1',
  delivery_loss_tolerance_pct: '', is_active: true,
};

export default function Companies() {
  const { user, can } = useAuth();
  const { notify } = useApp();
  const [rows, setRows] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null | {..company} (new if !id)
  const isGroupAdmin = user?.is_superuser || user?.role === 'GROUP_ADMIN' || user?.role === 'SUPERUSER';

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.companies.list({ search, ordering: 'code', page_size: 200 });
      setRows(res?.results || res || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.currencies.listAll().then(setCurrencies).catch(() => {});
  }, []);

  const openNew = () => setEditing({ ...EMPTY });
  const openEdit = (c) => setEditing({ ...c });

  const remove = async (c) => {
    if (!window.confirm(`Delete company ${c.code}? This cannot be undone.`)) return;
    try {
      await api.companies.remove(c.id);
      notify('Company deleted.', 'success');
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Legal entities</h1>
          <p className="page-header__subtitle">Companies in the group</p>
        </div>
        <div className="page-header__actions">
          {isGroupAdmin && can('company.edit') && (
            <button className="btn btn-primary" onClick={openNew}>
              <i className="bi bi-plus-lg" /> New company
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{rows.length} entit{rows.length === 1 ? 'y' : 'ies'}</span>
        </div>

        {error ? (
          <div className="card__body">
            <p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button>
          </div>
        ) : !rows.length && !loading ? (
          <div className="table-empty">
            <div className="table-empty__title">No companies yet</div>
            <div>Create the first legal entity to get started.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Country</th><th>Currency</th>
                  <th>Valuation</th><th>Status</th><th className="col-actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="is-clickable" onClick={() => openEdit(c)}>
                    <td className="mono">{c.code}</td>
                    <td>{c.name}</td>
                    <td>{c.country}</td>
                    <td>{c.functional_currency_label || c.functional_currency}</td>
                    <td>{c.inventory_valuation}</td>
                    <td>
                      <span className={`status ${c.is_active ? 'status-active' : 'status-inactive'}`}>
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      {can('company.edit') && (
                        <div className="row-actions">
                          <button className="row-action" title="Edit" onClick={() => openEdit(c)}><i className="bi bi-pencil" /></button>
                          {isGroupAdmin && (
                            <button className="row-action row-action--danger" title="Delete" onClick={() => remove(c)}><i className="bi bi-trash" /></button>
                          )}
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
        <CompanyModal
          company={editing}
          currencies={currencies}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); notify('Company saved.', 'success'); }}
        />
      )}
    </div>
  );
}

function CompanyModal({ company, currencies, onClose, onSaved }) {
  const isNew = !company.id;
  const [form, setForm] = useState({ ...company });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      if (body.functional_currency && typeof body.functional_currency === 'object') body.functional_currency = body.functional_currency.id;
      if (isNew) await api.companies.create(body);
      else await api.companies.update(company.id, body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err)); setFieldErr(fieldErrors(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <div>
            <h2 className="modal__title">{isNew ? 'New company' : `Edit ${company.code}`}</h2>
            <p className="modal__subtitle">Legal entity details</p>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Code" required err={fieldErr.code}>
                <input className="input mono" value={form.code} onChange={set('code')} required maxLength={10} disabled={!isNew} />
              </Field>
              <Field label="Name" required err={fieldErr.name}>
                <input className="input" value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Country">
                <select className="select" value={form.country} onChange={set('country')}>
                  <option value="KE">Kenya</option>
                  <option value="CD">DR Congo</option>
                </select>
              </Field>
              <Field label="Functional currency" required err={fieldErr.functional_currency}>
                <select className="select" value={form.functional_currency || ''} onChange={set('functional_currency')} required>
                  <option value="">—</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Tax PIN"><input className="input" value={form.tax_pin} onChange={set('tax_pin')} /></Field>
              <Field label="Registration number"><input className="input" value={form.registration_number} onChange={set('registration_number')} /></Field>
              <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Email"><input type="email" className="input" value={form.email} onChange={set('email')} /></Field>
              <Field label="Address" span><textarea className="textarea" rows={2} value={form.address} onChange={set('address')} /></Field>
              <Field label="Inventory valuation">
                <select className="select" value={form.inventory_valuation} onChange={set('inventory_valuation')}>
                  <option value="WAVG">Weighted average</option>
                  <option value="FIFO">FIFO</option>
                </select>
              </Field>
              <Field label="Min. margin %"><input type="number" step="0.001" className="input" value={form.min_margin_pct} onChange={set('min_margin_pct')} /></Field>
              <Field label="Match tolerance %"><input type="number" step="0.001" className="input" value={form.match_tolerance_pct} onChange={set('match_tolerance_pct')} /></Field>
              <Field label="Delivery loss tolerance %"><input type="number" step="0.001" className="input" value={form.delivery_loss_tolerance_pct} onChange={set('delivery_loss_tolerance_pct')} /></Field>
              <Field label="Active" span>
                <label className="check"><input type="checkbox" checked={!!form.is_active} onChange={set('is_active')} /> Company is active</label>
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