/**
 * Supplier contracts.
 * - CRUD /supplier-contracts/  (withStatus: status changed via setStatus)
 * - Allowed statuses: DRAFT, ACTIVE, EXPIRED, CANCELLED
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import { Field, Pagination } from './Suppliers';

const STATUS = ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function Contracts() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [c, s, p] = await Promise.all([
        api.supplierContracts.listAll({ ...companyParams(), ordering: '-id' }),
        api.suppliers.listAll({ ...companyParams() }),
        api.products.listAll(),
      ]);
      setRows(c); setSuppliers(s); setProducts(p);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (c, status) => {
    try { await api.supplierContracts.setStatus(c.id, status); notify(`Status: ${status}`, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Supplier contracts</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('suppliers.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg" /> New contract
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No contracts</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Supplier</th><th>Product</th>
                <th>Start</th><th>End</th><th className="num">Max qty</th>
                <th>Price basis</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.reference}</td>
                    <td>{c.supplier_label || c.supplier}</td>
                    <td>{c.product_label || '—'}</td>
                    <td>{c.start_date}</td>
                    <td>{c.end_date || '—'}</td>
                    <td className="num">{Number(c.max_quantity || 0).toLocaleString()}</td>
                    <td>{c.price_basis || '—'}</td>
                    <td><span className={`status ${c.status === 'ACTIVE' ? 'status-active' : c.status === 'EXPIRED' ? 'status-closed' : c.status === 'CANCELLED' ? 'status-rejected' : 'status-draft'}`}>{c.status}</span></td>
                    <td className="col-actions">
                      {can('suppliers.edit') && (
                        <div className="row-actions">
                          <select className="select select-sm" value={c.status} onChange={(e) => setStatus(c, e.target.value)}>
                            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <button className="row-action" title="Edit" onClick={() => setEditing(c)}><i className="bi bi-pencil" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <ContractModal row={editing} suppliers={suppliers} products={products} companyParams={companyParams}
                       onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function ContractModal({ row, suppliers, products, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    supplier: row.supplier || '', product: row.product || '',
    start_date: row.start_date || todayISO(), end_date: row.end_date || '',
    price_basis: row.price_basis || '', max_quantity: row.max_quantity ?? '',
    terms: row.terms || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.product) delete body.product;
      if (!body.end_date) body.end_date = null;
      isNew ? await api.supplierContracts.create(body) : await api.supplierContracts.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--lg">
        <div className="modal__header">
          <h2 className="modal__title">{isNew ? 'New contract' : `Edit ${row.reference}`}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Supplier" required>
                <select className="select" value={form.supplier} onChange={set('supplier')} required>
                  <option value="">—</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                </select>
              </Field>
              <Field label="Product">
                <select className="select" value={form.product} onChange={set('product')}>
                  <option value="">—</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </Field>
              <Field label="Start date" required>
                <input type="date" className="input" value={form.start_date} onChange={set('start_date')} required />
              </Field>
              <Field label="End date">
                <input type="date" className="input" value={form.end_date} onChange={set('end_date')} />
              </Field>
              <Field label="Max quantity"><input type="number" step="0.001" className="input num" value={form.max_quantity} onChange={set('max_quantity')} /></Field>
              <Field label="Price basis"><input className="input" value={form.price_basis} onChange={set('price_basis')} placeholder="e.g. CBK + 2%"/></Field>
              <Field label="Terms" span><textarea className="textarea" rows={2} value={form.terms} onChange={set('terms')} /></Field>
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