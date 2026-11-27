/**
 * Suppliers list.
 * - CRUD /suppliers/      (crud)
 * - GET  /suppliers/:id/statement/        ? running balance per currency
 * - GET  /suppliers/:id/price-history/    ? last 200 supplier prices
 * - GET  /suppliers/:id/performance/      ? orders, fill rate, invoice exceptions
 *
 * "New supplier" here, detail & sub-features on SupplierDetail.jsx.
 * Exports SupplierModal and supplierStatusPill for SupplierDetail.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import ServerPagination from '../../components/ServerPagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUS = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE'];

export const supplierStatusPill = (s) => {
  if (s === 'ACTIVE') return 'status-pill--success';
  if (s === 'SUSPENDED') return 'status-pill--warning';
  return 'status-pill--neutral'; // ONBOARDING, INACTIVE
};

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
            <h1 className="page-title">Suppliers</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('suppliers.edit') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg"></i>
              New supplier
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
              placeholder="Search by code, name or tax PIN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search suppliers"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
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
                Status: {status}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Supplier List
          </span>
          <span className="chart-card__subtitle">
            {count} supplier{count !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-building"></i>
            <h6>{hasActiveFilters ? 'No suppliers match your search' : 'No suppliers yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New supplier' to add the first one"}
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
                    <th>Tax PIN</th>
                    <th className="text-right">Credit limit</th>
                    <th>Terms</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '6rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-mono fw-600">
                        <Link to={`/procurement/suppliers/${s.id}`} className="text-brand">{s.code}</Link>
                      </td>
                      <td className="cell-name">{s.name}</td>
                      <td>{s.country}</td>
                      <td className="cell-mono">{s.tax_pin || '—'}</td>
                      <td className="cell-num">{Number(s.credit_limit || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td>{s.payment_terms_days} days</td>
                      <td><span className={`status-pill ${supplierStatusPill(s.status)}`}>{s.status}</span></td>
                      <td>
                        <div className="row-actions">
                          <Link to={`/procurement/suppliers/${s.id}`} className="btn btn-icon" title="Open" aria-label="Open">
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
        <SupplierModal
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); notify('Supplier created.', 'success'); load(); }}
        />
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
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New supplier' : `Edit ${row.code}`}
      subtitle="Supplier master data"
      icon="bi-building"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="supplierForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="supplierForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Supplier Details</h6>
        <div className="form-grid">
          <Field label="Code" err={fieldErr.code}>
            <input className="form-control font-mono" value={form.code} onChange={set('code')} disabled={!isNew}
                   placeholder="Auto-generated if blank" />
          </Field>
          <Field label="Name" required err={fieldErr.name}>
            <input className="form-control" value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Country"><input className="form-control" value={form.country} onChange={set('country')} /></Field>
          <Field label="Tax PIN"><input className="form-control font-mono" value={form.tax_pin} onChange={set('tax_pin')} /></Field>
          <Field label="Registration">
            <input className="form-control font-mono" value={form.registration_number} onChange={set('registration_number')} />
          </Field>
          <Field label="Status">
            <select className="form-select" value={form.status} onChange={set('status')}>
              {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Contact person">
            <input className="form-control" value={form.contact_person} onChange={set('contact_person')} />
          </Field>
          <Field label="Phone"><input className="form-control" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Email"><input type="email" className="form-control" value={form.email} onChange={set('email')} /></Field>
          <Field label="Address" span>
            <textarea className="form-control" rows={2} value={form.address} onChange={set('address')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-bank" aria-hidden="true"></i>Banking & Terms</h6>
        <div className="form-grid">
          <Field label="Bank"><input className="form-control" value={form.bank_name} onChange={set('bank_name')} /></Field>
          <Field label="Bank account">
            <input className="form-control font-mono" value={form.bank_account} onChange={set('bank_account')} />
          </Field>
          <Field label="SWIFT"><input className="form-control font-mono" value={form.bank_swift} onChange={set('bank_swift')} /></Field>
          <Field label="Payment terms (days)">
            <input type="number" min={0} className="form-control num" value={form.payment_terms_days} onChange={set('payment_terms_days')} />
          </Field>
          <Field label="Credit limit">
            <input type="number" step="0.01" className="form-control num" value={form.credit_limit} onChange={set('credit_limit')} />
          </Field>
          <Field label="Currency">
            <select className="form-select" value={form.currency} onChange={set('currency')}>
              <option value="">—</option>
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
        </div>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}