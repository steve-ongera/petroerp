/**
 * Sales invoices.
 * - CRUD /sales-invoices/ (nested lines)
 * - POST /sales-invoices/:id/post/ { override }   (credit-limit override needs credit.override)
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import TableSkeleton from '../../components/TableSkeleton';
import { ServerPagination } from './Customers';

const STATUSES = ['DRAFT', 'POSTED', 'PART_PAID', 'PAID', 'CANCELLED'];
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const invoiceStatusPill = (s) => {
  if (s === 'PAID') return 'status-pill--success';
  if (s === 'POSTED') return 'status-pill--info';
  if (s === 'PART_PAID') return 'status-pill--warning';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral';
};

export default function SalesInvoices() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.salesInvoices.list({
        ...companyParams(), ordering: '-id', page,
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

  const post = async (inv) => {
    if (!window.confirm(`Post invoice ${inv.reference}?`)) return;
    try { await api.salesInvoices.post(inv.id, false); notify('Posted.', 'success'); load(); }
    catch (err) {
      const msg = errorMessage(err);
      if (/credit limit/i.test(msg) && can('credit.override')) {
        if (window.confirm(`${msg}\n\nOverride credit limit and post anyway?`)) {
          try { await api.salesInvoices.post(inv.id, true); notify('Posted with override.', 'success'); load(); }
          catch (e) { notify(errorMessage(e), 'error'); }
        }
      } else notify(msg, 'error');
    }
  };

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-receipt-cutoff"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Sales invoices</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('sales.edit') && (
            <Link to="/sales/invoices/new" className="btn btn-primary">
              <i className="bi bi-plus-lg"></i>
              New invoice
            </Link>
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
              placeholder="Search by reference or customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search invoices"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
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
            Invoice List
          </span>
          <span className="chart-card__subtitle">
            {count} invoice{count !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-receipt-cutoff"></i>
            <h6>{hasActiveFilters ? 'No invoices match your search' : 'No invoices yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New invoice' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Due</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Outstanding</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '8rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <td className="cell-mono fw-600">
                        <Link to={`/sales/invoices/${i.id}`} className="text-brand">{i.reference}</Link>
                      </td>
                      <td className="cell-name">{i.customer_label || i.customer}</td>
                      <td>{i.invoice_date}</td>
                      <td>{i.due_date || '—'}</td>
                      <td className="cell-num">{fmtMoney(i.total, i.currency)}</td>
                      <td className="cell-num">{fmtMoney(i.outstanding)}</td>
                      <td><span className={`status-pill ${invoiceStatusPill(i.status)}`}>{i.status.replace('_', ' ')}</span></td>
                      <td>
                        <div className="row-actions">
                          {i.status === 'DRAFT' && can('sales.edit') && (
                            <button className="btn btn-sm btn-primary" onClick={() => post(i)}>Post</button>
                          )}
                          <Link to={`/sales/invoices/${i.id}`} className="btn btn-icon" title="Open" aria-label="Open">
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
    </div>
  );
}