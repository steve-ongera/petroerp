/**
 * Purchase orders.
 * - CRUD /purchase-orders/ (withSubmit)
 * - Row: reference, requisition, supplier, order_date, expected loading, status, total
 * - New PO (from an approved requisition) → detail → submit → receive → invoice
 *
 * Permissions: procurement.view (page), procurement.create (new / submit).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useAccess } from '../../utils/access';
import api, { errorMessage } from '../../services/api';
import ServerPagination from '../../components/ServerPagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUSES = ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'INVOICED', 'CLOSED', 'CANCELLED'];
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const poStatusPill = (s) => {
  if (s === 'APPROVED') return 'status-pill--success';
  if (s === 'AWAITING_APPROVAL') return 'status-pill--warning';
  if (s === 'DRAFT') return 'status-pill--neutral';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--info'; // PARTIALLY_RECEIVED, RECEIVED, INVOICED, CLOSED
};

export default function PurchaseOrders() {
  const { can } = useAccess();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canCreate = can('procurement.create');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.purchaseOrders.list({
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

  const submit = async (po) => {
    try {
      const res = await api.purchaseOrders.submit(po.id);
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
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-bag-check"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Purchase orders</h1>
            <p className="page-subtitle">{activeCompanyObj ? activeCompanyObj.name : 'All entities'}</p>
          </div>
        </div>
        <div className="page-header__actions">
          {canCreate && (
            <Link to="/procurement/purchase-orders/new" className="btn btn-primary">
              <i className="bi bi-plus-lg"></i>
              New PO
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
              placeholder="Search by reference or supplier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search purchase orders"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
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
                Status: {status.replace(/_/g, ' ')}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Purchase Order List
          </span>
          <span className="chart-card__subtitle">
            {count} order{count !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-bag-check"></i>
            <h6>{hasActiveFilters ? 'No purchase orders match your search' : 'No purchase orders yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : 'Open an approved requisition and click Create PO'}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Requisition</th>
                    <th>Supplier</th>
                    <th>Order date</th>
                    <th>Expected loading</th>
                    <th className="text-right">Total</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '8rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((po) => (
                    <tr key={po.id}>
                      <td className="cell-mono fw-600">
                        <Link to={`/procurement/purchase-orders/${po.id}`} className="text-brand">{po.reference}</Link>
                      </td>
                      <td className="cell-mono">{po.requisition_label || '—'}</td>
                      <td className="cell-name">{po.supplier_label || po.supplier}</td>
                      <td>{po.order_date}</td>
                      <td>{po.expected_loading_date || '—'}</td>
                      <td className="cell-num">{fmtMoney(po.total, po.currency)}</td>
                      <td><span className={`status-pill ${poStatusPill(po.status)}`}>{po.status.replace(/_/g, ' ')}</span></td>
                      <td>
                        <div className="row-actions">
                          {po.status === 'DRAFT' && canCreate && (
                            <button className="btn btn-sm btn-primary" onClick={() => submit(po)}>Submit</button>
                          )}
                          <Link to={`/procurement/purchase-orders/${po.id}`} className="btn btn-icon" title="Open" aria-label="Open">
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