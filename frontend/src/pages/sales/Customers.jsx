/**
 * Customers.
 * - CRUD /customers/       (crud)
 * - GET  /customers/:id/statement/
 * - GET  /customers/:id/credit-status/
 * - POST /customers/:id/set-credit-limit/  { limit, reason }  (needs credit.override)
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';

const STATUS = ['ACTIVE', 'ON_HOLD', 'BLOCKED', 'INACTIVE'];
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function Customers() {
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
      const res = await api.customers.list({
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
          <h1 className="page-header__title">Customers</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'} · {count} customer{count === 1 ? '' : 's'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('customers.edit') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg" /> New customer
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Search code, name, tax registration…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <div className="filters__spacer" />
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No customers</div>
            <div>Add the first customer.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Code</th><th>Name</th><th>Country</th>
                <th className="num">Credit limit</th><th>Terms</th>
                <th>Credit period</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">
                      <Link to={`/sales/customers/${c.id}`} className="cell-link">{c.code}</Link>
                    </td>
                    <td>{c.name}</td>
                    <td>{c.country}</td>
                    <td className="num">{fmtMoney(c.credit_limit, c.currency)}</td>
                    <td>{c.payment_terms || '—'}</td>
                    <td>{c.credit_period_days} days</td>
                    <td><span className={`status ${c.status === 'ACTIVE' ? 'status-active' : c.status === 'ON_HOLD' ? 'status-pending' : c.status === 'BLOCKED' ? 'status-rejected' : 'status-inactive'}`}>{c.status.replace('_', ' ')}</span></td>
                    <td className="col-actions">
                      <Link to={`/sales/customers/${c.id}`} className="row-action" title="Open">
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
        <CustomerModal onClose={() => setCreating(false)}
                       onSaved={() => { setCreating(false); notify('Customer created.', 'success'); load(); }} />
      )}
    </div>
  );
}

export function CustomerModal({ row = {}, onClose, onSaved }) {
  const { companyParams } = useApp();
  const isNew = !row.id;
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState({
    code: row.code || '', name: row.name || '', country: row.country || 'DRC',
    address: row.address || '', tax_registration: row.tax_registration || '',
    contact_person: row.contact_person || '', phone: row.phone || '', email: row.email || '',
    currency: row.currency || '', credit_limit: row.credit_limit ?? '',
    payment_terms: row.payment_terms || '', credit_period_days: row.credit_period_days ?? 30,
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
      isNew ? await api.customers.create(body) : await api.customers.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New customer' : `Edit ${row.code}`}</h2>
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
              <Field label="Tax registration"><input className="input mono" value={form.tax_registration} onChange={set('tax_registration')} /></Field>
              <Field label="Contact person"><input className="input" value={form.contact_person} onChange={set('contact_person')} /></Field>
              <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Email"><input type="email" className="input" value={form.email} onChange={set('email')} /></Field>
              <Field label="Currency">
                <select className="select" value={form.currency} onChange={set('currency')}>
                  <option value="">—</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="Credit limit"><input type="number" step="0.01" className="input num" value={form.credit_limit} onChange={set('credit_limit')} /></Field>
              <Field label="Payment terms"><input className="input" value={form.payment_terms} onChange={set('payment_terms')} /></Field>
              <Field label="Credit period (days)"><input type="number" min={0} className="input num" value={form.credit_period_days} onChange={set('credit_period_days')} /></Field>
              <Field label="Status">
                <select className="select" value={form.status} onChange={set('status')}>
                  {STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
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