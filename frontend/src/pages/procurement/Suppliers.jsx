/**
 * Suppliers list.
 * - CRUD /suppliers/      (crud)
 * - GET  /suppliers/:id/statement/        → running balance per currency
 * - GET  /suppliers/:id/price-history/    → last 200 supplier prices
 * - GET  /suppliers/:id/performance/      → orders, fill rate, invoice exceptions
 *
 * "New supplier" here, detail & sub-features on SupplierDetail.jsx.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const STATUS = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE'];

export default function Suppliers() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.suppliers.list({
        ...companyParams(), ordering: 'code', page,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, search, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status]);

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Suppliers</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'} · {count} supplier{count === 1 ? '' : 's'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('suppliers.edit') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg" /> New supplier
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search code, name, tax PIN…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="filters__spacer" />
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No suppliers</div>
            <div>Add the first supplier.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Code</th><th>Name</th><th>Country</th><th>Tax PIN</th>
                <th className="num">Credit limit</th><th>Terms</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">
                      <Link to={`/procurement/suppliers/${s.id}`} className="cell-link">{s.code}</Link>
                    </td>
                    <td>{s.name}</td>
                    <td>{s.country}</td>
                    <td className="mono">{s.tax_pin || '—'}</td>
                    <td className="num">{Number(s.credit_limit || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td>{s.payment_terms_days} days</td>
                    <td><span className={`status ${s.status === 'ACTIVE' ? 'status-active' : s.status === 'SUSPENDED' ? 'status-pending' : s.status === 'ONBOARDING' ? 'status-draft' : 'status-inactive'}`}>{s.status}</span></td>
                    <td className="col-actions">
                      <Link to={`/procurement/suppliers/${s.id}`} className="row-action" title="Open">
                        <i className="bi bi-arrow-right" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} count={count} onChange={setPage} />
      </div>

      {creating && (
        <SupplierModal onClose={() => setCreating(false)}
                       onSaved={() => { setCreating(false); notify('Supplier created.', 'success'); load(); }} />
      )}
    </div>
  );
}

export function SupplierModal({ row = {}, onClose, onSaved }) {
  const { companyParams } = useApp();
  const isNew = !row.id;
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', country: row.country || 'Kenya',
    tax_pin: row.tax_pin || '', registration_number: row.registration_number || '',
    address: row.address || '', contact_person: row.contact_person || '',
    phone: row.phone || '', email: row.email || '',
    bank_name: row.bank_name || '', bank_account: row.bank_account || '',
    bank_swift: row.bank_swift || '',
    payment_terms_days: row.payment_terms_days ?? 30,
    credit_limit: row.credit_limit ?? '', currency: row.currency || '',
    status: row.status || 'ACTIVE',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => { api.currencies.listAll().then(setCurrencies).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      isNew ? await api.suppliers.create(body) : await api.suppliers.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New supplier' : `Edit ${row.code}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Code" err={fieldErr.code}>
                <input className="input mono" value={form.code} onChange={set('code')} disabled={!isNew}
                       placeholder="Auto-generated if blank" />
              </Field>
              <Field label="Name" required err={fieldErr.name}>
                <input className="input" value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Country"><input className="input" value={form.country} onChange={set('country')} /></Field>
              <Field label="Tax PIN"><input className="input mono" value={form.tax_pin} onChange={set('tax_pin')} /></Field>
              <Field label="Registration"><input className="input mono" value={form.registration_number} onChange={set('registration_number')} /></Field>
              <Field label="Contact person"><input className="input" value={form.contact_person} onChange={set('contact_person')} /></Field>
              <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Email"><input type="email" className="input" value={form.email} onChange={set('email')} /></Field>
              <Field label="Bank"><input className="input" value={form.bank_name} onChange={set('bank_name')} /></Field>
              <Field label="Bank account"><input className="input mono" value={form.bank_account} onChange={set('bank_account')} /></Field>
              <Field label="SWIFT"><input className="input mono" value={form.bank_swift} onChange={set('bank_swift')} /></Field>
              <Field label="Payment terms (days)"><input type="number" min={0} className="input num" value={form.payment_terms_days} onChange={set('payment_terms_days')} /></Field>
              <Field label="Credit limit"><input type="number" step="0.01" className="input num" value={form.credit_limit} onChange={set('credit_limit')} /></Field>
              <Field label="Currency">
                <select className="select" value={form.currency} onChange={set('currency')}>
                  <option value="">—</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className="select" value={form.status} onChange={set('status')}>
                  {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Address" span><textarea className="textarea" rows={2} value={form.address} onChange={set('address')} /></Field>
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

export function Field({ label, required, err, span, children }) {
  return (
    <div className={`field ${span ? 'span-all' : ''} ${err ? 'has-error' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
      {err && <span className="field-error">{err}</span>}
    </div>
  );
}

export function Pagination({ page, count, onChange, size = 25 }) {
  const pages = Math.max(1, Math.ceil((count || 0) / size));
  if (count <= size) return null;
  return (
    <div className="pagination pagination--bordered">
      <span className="pagination__info">Page <strong>{page}</strong> of <strong>{pages}</strong> · {count} items</span>
      <div className="pagination__list">
        <button className="pagination__btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <button className="pagination__btn active">{page}</button>
        <button className="pagination__btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}