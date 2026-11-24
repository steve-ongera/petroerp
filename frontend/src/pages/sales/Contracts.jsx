/**
 * Customer contracts.
 * - CRUD /customer-contracts/ (withStatus: DRAFT / ACTIVE / EXPIRED / CANCELLED)
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';
import { Field } from './Customers';

const STATUS = ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'];
const PRICING = ['FIXED', 'MARKET', 'COST_PLUS'];
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Contracts() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [c, cu, p, cc] = await Promise.all([
        api.customerContracts.listAll({ ...companyParams(), ordering: '-id' }),
        api.customers.listAll({ ...companyParams() }),
        api.products.listAll(),
        api.currencies.listAll(),
      ]);
      setRows(c); setCustomers(cu); setProducts(p); setCurrencies(cc);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (c, status) => {
    try { await api.customerContracts.setStatus(c.id, status); notify(`Status: ${status}`, 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Customer contracts</h1>
          <p className="page-header__subtitle">
            {activeCompanyObj ? activeCompanyObj.name : 'All entities'}
          </p>
        </div>
        <div className="page-header__actions">
          {can('sales.edit') && (
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
                <th>Reference</th><th>Customer</th><th>Product</th>
                <th>Pricing</th><th className="num">Price</th>
                <th>Valid from</th><th>Valid to</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.reference}</td>
                    <td>{r.customer_label || r.customer}</td>
                    <td>{r.product_label || r.product}</td>
                    <td><span className="badge">{r.pricing_method}</span></td>
                    <td className="num">{Number(r.price_per_litre || 0).toFixed(6)}</td>
                    <td>{r.valid_from}</td>
                    <td>{r.valid_to || '—'}</td>
                    <td><span className={`status ${r.status === 'ACTIVE' ? 'status-active' : r.status === 'EXPIRED' ? 'status-closed' : r.status === 'CANCELLED' ? 'status-rejected' : 'status-draft'}`}>{r.status}</span></td>
                    <td className="col-actions">
                      {can('sales.edit') && (
                        <div className="row-actions">
                          <select className="select select-sm" value={r.status} onChange={(e) => setStatus(r, e.target.value)}>
                            {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <button className="row-action" title="Edit" onClick={() => setEditing(r)}><i className="bi bi-pencil" /></button>
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
        <ContractModal row={editing} customers={customers} products={products} currencies={currencies} companyParams={companyParams}
                       onClose={() => setEditing(null)} onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }} />
      )}
    </div>
  );
}

function ContractModal({ row, customers, products, currencies, companyParams, onClose, onSaved }) {
  const isNew = !row.id;
  const [form, setForm] = useState({
    customer: row.customer || '', product: row.product || '',
    pricing_method: row.pricing_method || 'FIXED', price_per_litre: row.price_per_litre ?? '',
    currency: row.currency || '', contract_quantity: row.contract_quantity ?? '',
    valid_from: row.valid_from || todayISO(), valid_to: row.valid_to || '',
    delivery_terms: row.delivery_terms || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...form, company: companyParams().company };
      if (!body.valid_to) body.valid_to = null;
      isNew ? await api.customerContracts.create(body) : await api.customerContracts.update(row.id, body);
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
              <Field label="Customer" required>
                <select className="select" value={form.customer} onChange={set('customer')} required>
                  <option value="">—</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Product" required>
                <select className="select" value={form.product} onChange={set('product')} required>
                  <option value="">—</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                </select>
              </Field>
              <Field label="Pricing method">
                <select className="select" value={form.pricing_method} onChange={set('pricing_method')}>
                  {PRICING.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Price per litre"><input type="number" step="0.000001" className="input num" value={form.price_per_litre} onChange={set('price_per_litre')} /></Field>
              <Field label="Currency">
                <select className="select" value={form.currency} onChange={set('currency')}>
                  <option value="">—</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="Contract quantity"><input type="number" step="0.001" className="input num" value={form.contract_quantity} onChange={set('contract_quantity')} /></Field>
              <Field label="Valid from" required>
                <input type="date" className="input" value={form.valid_from} onChange={set('valid_from')} required />
              </Field>
              <Field label="Valid to"><input type="date" className="input" value={form.valid_to} onChange={set('valid_to')} /></Field>
              <Field label="Delivery terms" span><input className="input" value={form.delivery_terms} onChange={set('delivery_terms')} /></Field>
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