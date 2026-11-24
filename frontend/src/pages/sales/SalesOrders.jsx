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
import { Pagination } from './Customers';

const STATUSES = ['', 'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'IN_FULFILMENT', 'COMPLETED', 'CANCELLED'];
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      setCount(res?.count ?? (res?.results || []).length);
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

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Sales orders</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('sales.edit') && (
            <Link to="/sales/orders/new" className="btn btn-primary">
              <i className="bi bi-plus-lg" /> New order
            </Link>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Reference, customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace('_', ' ') : 'All statuses'}</option>)}
          </select>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No sales orders</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Customer</th><th>Order date</th><th>Required</th>
                <th className="num">Total</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((so) => (
                  <tr key={so.id}>
                    <td className="mono">
                      <Link to={`/sales/orders/${so.id}`} className="cell-link">{so.reference}</Link>
                    </td>
                    <td>{so.customer_label || so.customer}</td>
                    <td>{so.order_date}</td>
                    <td>{so.required_date || '—'}</td>
                    <td className="num">{fmtMoney(so.total, so.currency)}</td>
                    <td><span className={`status ${so.status === 'APPROVED' ? 'status-active' : so.status === 'COMPLETED' ? 'status-closed' : so.status === 'CANCELLED' ? 'status-rejected' : ['AWAITING_APPROVAL', 'IN_FULFILMENT'].includes(so.status) ? 'status-pending' : 'status-draft'}`}>{so.status.replace('_', ' ')}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {so.status === 'DRAFT' && can('sales.edit') && (
                          <button className="btn btn-xs" onClick={() => submit(so)}>Submit</button>
                        )}
                        <Link to={`/sales/orders/${so.id}`} className="row-action" title="Open">
                          <i className="bi bi-arrow-right" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} count={count} onChange={setPage} />
      </div>
    </div>
  );
}