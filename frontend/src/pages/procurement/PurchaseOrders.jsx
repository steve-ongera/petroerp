/**
 * Purchase orders.
 * - CRUD /purchase-orders/ (withSubmit)
 * - Row: reference, supplier, order_date, expected loading, status, total
 * - New PO → detail → submit → receive → invoice
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import { Pagination } from './Suppliers';

const STATUSES = ['', 'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'INVOICED', 'CLOSED', 'CANCELLED'];
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function PurchaseOrders() {
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
      const res = await api.purchaseOrders.list({
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

  const submit = async (po) => {
    try {
      const res = await api.purchaseOrders.submit(po.id);
      notify(res.approval_request ? 'Sent for approval.' : 'Auto-approved.', 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Purchase orders</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('procurement.edit') && (
            <Link to="/procurement/purchase-orders/new" className="btn btn-primary">
              <i className="bi bi-plus-lg" /> New PO
            </Link>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Reference, supplier…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace('_', ' ') : 'All statuses'}</option>)}
          </select>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No purchase orders</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Supplier</th><th>Order date</th>
                <th>Expected loading</th><th className="num">Total</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((po) => (
                  <tr key={po.id}>
                    <td className="mono">
                      <Link to={`/procurement/purchase-orders/${po.id}`} className="cell-link">{po.reference}</Link>
                    </td>
                    <td>{po.supplier_label || po.supplier}</td>
                    <td>{po.order_date}</td>
                    <td>{po.expected_loading_date || '—'}</td>
                    <td className="num">{fmtMoney(po.total, po.currency)}</td>
                    <td><span className={`status ${po.status === 'APPROVED' ? 'status-active' : po.status === 'AWAITING_APPROVAL' ? 'status-pending' : po.status === 'DRAFT' ? 'status-draft' : po.status === 'CANCELLED' ? 'status-rejected' : 'status-posted'}`}>{po.status.replace(/_/g, ' ')}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {po.status === 'DRAFT' && can('procurement.edit') && (
                          <button className="btn btn-xs" onClick={() => submit(po)}>Submit</button>
                        )}
                        <Link to={`/procurement/purchase-orders/${po.id}`} className="row-action" title="Open">
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