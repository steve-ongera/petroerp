/**
 * Purchase requisitions.
 * - CRUD /purchase-requisitions/ (withSubmit + setStatus('CONVERTED'))
 * - Submit → approval workflow
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import { Field, Pagination } from './Suppliers';

const STATUSES = ['', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED'];
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Requisitions() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [products, setProducts] = useState([]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.purchaseRequisitions.list({
        ...companyParams(), ordering: '-id', page,
        ...(status ? { status } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.products.listAll().then(setProducts).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [status]);

  const submit = async (r) => {
    try {
      const res = await api.purchaseRequisitions.submit(r.id);
      notify(res.approval_request ? 'Sent for approval.' : 'Auto-approved.', 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Purchase requisitions</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('procurement.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New requisition
            </button>
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
          <div className="table-empty"><div className="table-empty__title">No requisitions</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Product</th><th>Qty</th>
                <th>Required by</th><th>Reason</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="is-clickable" onClick={() => setEditing(r)}>
                    <td className="mono">{r.reference}</td>
                    <td>{r.product_label || r.product}</td>
                    <td className="num">{Number(r.quantity || 0).toLocaleString()}</td>
                    <td>{r.required_date || '—'}</td>
                    <td className="text-truncate" style={{ maxWidth: 300 }}>{r.reason || '—'}</td>
                    <td><span className={`status ${r.status === 'APPROVED' ? 'status-active' : ['SUBMITTED'].includes(r.status) ? 'status-pending' : r.status === 'REJECTED' ? 'status-rejected' : r.status === 'CONVERTED' ? 'status-posted' : 'status-draft'}`}>{r.status}</span></td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        {r.status === 'DRAFT' && can('procurement.edit') && (
                          <button className="btn btn-xs" onClick={() => submit(r)}>Submit</button>
                        )}
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

      {editing && (
        <RequisitionModal row={editing} products={products} companyParams={companyParams}
                          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function RequisitionModal({ row, products, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    product: row.product || '', quantity: row.quantity ?? '',
    required_date: row.required_date || '', reason: row.reason || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.required_date) delete body.required_date;
      isNew ? await api.purchaseRequisitions.create(body) : await api.purchaseRequisitions.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New requisition' : `Edit ${row.reference}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form">
              <Field label="Product" required>
                <select className="select" value={form.product} onChange={set('product')} required>
                  <option value="">—</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </Field>
              <div className="form-grid">
                <Field label="Quantity" required>
                  <input type="number" step="0.001" className="input num" value={form.quantity} onChange={set('quantity')} required />
                </Field>
                <Field label="Required by"><input type="date" className="input" value={form.required_date} onChange={set('required_date')} /></Field>
              </div>
              <Field label="Reason"><textarea className="textarea" rows={2} value={form.reason} onChange={set('reason')} /></Field>
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