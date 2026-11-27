/**
 * Customers.
 * - CRUD /customers/       (crud)
 * - GET  /customers/:id/statement/
 * - GET  /customers/:id/credit-status/
 * - POST /customers/:id/set-credit-limit/  { limit, reason }  (needs credit.override)
 *
 * Exports: CustomerModal (used by CustomerDetail) and ServerPagination (used by the
 * server-paginated Sales lists). Field now comes from the shared components/Field.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['ACTIVE', 'ON_HOLD', 'BLOCKED', 'INACTIVE'];
const PAGE_SIZE = 25;

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const customerStatusPill = (s) => {
  if (s === 'ACTIVE') return 'status-pill--success';
  if (s === 'ON_HOLD') return 'status-pill--warning';
  if (s === 'BLOCKED') return 'status-pill--danger';
  return 'status-pill--neutral';
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
      setCount(res?.count ?? (res?.results || res || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, search, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status]);

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Customers</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('customers.edit') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg"></i>
              New customer
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by code, name or tax registration..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search customers"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
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
            {status && (
              <span className="filter-chip">
                Status: {status.replace('_', ' ')}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Customer List
          </span>
          <span className="chart-card__subtitle">
            {count} customer{count !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-people"></i>
            <h6>{hasActiveFilters ? 'No customers match your search' : 'No customers yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New customer' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Country</th>
                    <th className="text-right">Credit limit</th>
                    <th>Terms</th>
                    <th>Credit period</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '6rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className="cell-mono fw-600">
                        <Link to={`/sales/customers/${c.id}`} className="text-brand">{c.code}</Link>
                      </td>
                      <td className="cell-name">{c.name}</td>
                      <td>{c.country}</td>
                      <td className="cell-num">{fmtMoney(c.credit_limit, c.currency)}</td>
                      <td>{c.payment_terms || '—'}</td>
                      <td>{c.credit_period_days} days</td>
                      <td><span className={`status-pill ${customerStatusPill(c.status)}`}>{c.status.replace('_', ' ')}</span></td>
                      <td>
                        <div className="row-actions">
                          <Link to={`/sales/customers/${c.id}`} className="btn btn-icon" title="Open" aria-label="Open">
                            <i className="bi bi-arrow-right"></i>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <ServerPagination page={page} count={count} onChange={setPage} />}
      </section>

      {creating && (
        <CustomerModal
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); notify('Customer created.', 'success'); load(); }}
        />
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
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New customer' : `Edit ${row.code}`}
      subtitle="Customer master data"
      icon="bi-people"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="customerForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="customerForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Customer Details</h6>
        <div className="form-grid">
          <Field label="Code" err={fieldErr.code}>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} disabled={!isNew}
                   placeholder="Auto-generated if blank" />
          </Field>
          <Field label="Name" required err={fieldErr.name}>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Country"><input className="form-control" value={form.country} onChange={set('country')} /></Field>
          <Field label="Tax registration">
            <input className="form-control font-mono" value={form.tax_registration} onChange={set('tax_registration')} />
          </Field>
          <Field label="Contact person">
            <input className="form-control" value={form.contact_person} onChange={set('contact_person')} />
          </Field>
          <Field label="Phone"><input className="form-control" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input type="email" className="form-control" value={form.email} onChange={set('email')} /></Field>
          <Field label="Status">
            <select className="form-select" value={form.status} onChange={set('status')}>
              {STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Address" span>
            <textarea className="form-control" rows={2} value={form.address} onChange={set('address')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-credit-card" aria-hidden="true"></i>Credit & Terms</h6>
        <div className="form-grid">
          <Field label="Currency">
            <select className="form-select" value={form.currency} onChange={set('currency')}>
              <option value="">—</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
          <Field label="Credit limit">
            <input type="number" step="0.01" className="form-control num" value={form.credit_limit} onChange={set('credit_limit')} />
          </Field>
          <Field label="Payment terms">
            <input className="form-control" value={form.payment_terms} onChange={set('payment_terms')} />
          </Field>
          <Field label="Credit period (days)">
            <input type="number" min={0} className="form-control num" value={form.credit_period_days} onChange={set('credit_period_days')} />
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/** Server-side pager (page + count). Used by Customers, SalesOrders and SalesInvoices. */
export function ServerPagination({ page, count, onChange, size = PAGE_SIZE }) {
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