/**
 * Sales orders.
 * - CRUD /sales-orders/ (withSubmit, nested lines)
 * - POST /sales-orders/:id/submit/
 * - POST /sales-orders/:id/reserve/ { depot }
 * - POST /sales-orders/:id/cancel/
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import TableSkeleton from '../../components/TableSkeleton';
import { ServerPagination } from './Customers';

const STATUSES = ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'IN_FULFILMENT', 'COMPLETED', 'CANCELLED'];
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const orderStatusPill = (s) => {
  if (s === 'APPROVED' || s === 'COMPLETED') return 'status-pill--success';
  if (s === 'AWAITING_APPROVAL' || s === 'IN_FULFILMENT') return 'status-pill--warning';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral'; // DRAFT
};

export default function SalesOrders() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.salesOrders.list({
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

  const submit = async (so) => {
    try {
      const res = await api.salesOrders.submit(so.id);
      notify(res.approval_request ? 'Sent for approval.' : 'Auto-approved.', 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Sales orders</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('sales.edit') && (
            <Link to="/sales/orders/new" className="btn btn-primary">
              <i className="bi bi-plus-lg"></i>
              New order
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
              aria-label="Search sales orders"
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
            Order List
          </span>
          <span className="chart-card__subtitle">
            {count} order{count !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-cart-check"></i>
            <h6>{hasActiveFilters ? 'No sales orders match your search' : 'No sales orders yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New order' to add the first one"}
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
                    <th>Order date</th>
                    <th>Required</th>
                    <th className="text-right">Total</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '8rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((so) => (
                    <tr key={so.id}>
                      <td className="cell-mono fw-600">
                        <Link to={`/sales/orders/${so.id}`} className="text-brand">{so.reference}</Link>
                      </td>
                      <td className="cell-name">{so.customer_label || so.customer}</td>
                      <td>{so.order_date}</td>
                      <td>{so.required_date || '—'}</td>
                      <td className="cell-num">{fmtMoney(so.total, so.currency)}</td>
                      <td><span className={`status-pill ${orderStatusPill(so.status)}`}>{so.status.replace('_', ' ')}</span></td>
                      <td>
                        <div className="row-actions">
                          {so.status === 'DRAFT' && can('sales.edit') && (
                            <button className="btn btn-sm btn-primary" onClick={() => submit(so)}>Submit</button>
                          )}
                          <Link to={`/sales/orders/${so.id}`} className="btn btn-icon" title="Open" aria-label="Open">
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