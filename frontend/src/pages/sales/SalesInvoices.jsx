/**
 * Sales invoices.
 * - CRUD /sales-invoices/ (nested lines)
 * - POST /sales-invoices/:id/post/ { override }   (credit-limit override needs credit.override)
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import { Pagination } from './Customers';

const STATUSES = ['', 'DRAFT', 'POSTED', 'PART_PAID', 'PAID', 'CANCELLED'];
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function SalesInvoices() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.salesInvoices.list({
        ...companyParams(), ordering: '-id', page,
        ...(status ? { status } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status]);

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

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Sales invoices</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('sales.edit') && (
            <Link to="/sales/invoices/new" className="btn btn-primary">
              <i className="bi bi-plus-lg" /> New invoice
            </Link>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No invoices</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Customer</th><th>Date</th><th>Due</th>
                <th className="num">Total</th><th className="num">Outstanding</th>
                <th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">
                      <Link to={`/sales/invoices/${i.id}`} className="cell-link">{i.reference}</Link>
                    </td>
                    <td>{i.customer_label || i.customer}</td>
                    <td>{i.invoice_date}</td>
                    <td>{i.due_date || '—'}</td>
                    <td className="num">{fmtMoney(i.total, i.currency)}</td>
                    <td className="num">{fmtMoney(i.outstanding)}</td>
                    <td><span className={`status ${i.status === 'POSTED' ? 'status-posted' : i.status === 'PAID' ? 'status-paid' : i.status === 'PART_PAID' ? 'status-pending' : i.status === 'CANCELLED' ? 'status-rejected' : 'status-draft'}`}>{i.status}</span></td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {i.status === 'DRAFT' && can('sales.edit') && (
                          <button className="btn btn-xs btn-primary" onClick={() => post(i)}>Post</button>
                        )}
                        <Link to={`/sales/invoices/${i.id}`} className="row-action" title="Open">
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