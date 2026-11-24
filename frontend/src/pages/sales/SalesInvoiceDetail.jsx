/**
 * Sales invoice detail (create or edit).
 * Lines can be attached to a shipment, so invoice quantity is bounded by delivered-and-not-yet-invoiced.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function SalesInvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify, companyParams } = useApp();
  const isNew = id === 'new';

  if (isNew) return <CreateSI onCreated={(i) => navigate(`/sales/invoices/${i.id}`, { replace: true })} />;
  return <EditSI id={id} can={can} notify={notify} navigate={navigate} />;
}

function CreateSI({ onCreated }) {
  const { companyParams, notify } = useApp();
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ customer: '', sales_order: '', invoice_date: todayISO(), due_date: '', currency: '' });
  const [lines, setLines] = useState([{ product: '', quantity: '', unit_price: '', tax_code: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  useEffect(() => {
    Promise.all([
      api.customers.listAll({ ...companyParams(), status: 'ACTIVE' }),
      api.products.listAll(),
      api.currencies.listAll(),
    ]).then(([c, p, cur]) => { setCustomers(c); setProducts(p); setCurrencies(cur); }).catch(() => {});
  }, [companyParams]);

  useEffect(() => {
    if (!form.customer) { setOrders([]); return; }
    api.salesOrders.listAll({ ...companyParams(), customer: form.customer, status: 'APPROVED' }).then(setOrders).catch(() => {});
  }, [companyParams, form.customer]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = {
        ...form, company: companyParams().company,
        lines: lines.filter((l) => l.product && l.quantity && l.unit_price).map((l) => ({
          product: l.product, quantity: l.quantity, unit_price: l.unit_price,
          ...(l.tax_code ? { tax_code: l.tax_code } : {}),
        })),
      };
      ['sales_order', 'due_date', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
      const inv = await api.salesInvoices.create(body);
      notify('Invoice created.', 'success');
      onCreated(inv);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="app-content">
      <header className="page-header"><div className="page-header__main">
        <h1 className="page-header__title">New sales invoice</h1>
      </div></header>
      <form onSubmit={submit}>
        <div className="card"><div className="card__body">
          <div className="form-grid form-grid--3">
            <div className="field"><label className="label label--required">Customer</label>
              <select className="select" value={form.customer} onChange={set('customer')} required>
                <option value="">—</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </div>
            <div className="field"><label className="label">Sales order</label>
              <select className="select" value={form.sales_order} onChange={set('sales_order')}>
                <option value="">—</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.reference}</option>)}
              </select>
            </div>
            <div className="field"><label className="label label--required">Invoice date</label>
              <input type="date" className="input" value={form.invoice_date} onChange={set('invoice_date')} required />
            </div>
            <div className="field"><label className="label">Due date</label>
              <input type="date" className="input" value={form.due_date} onChange={set('due_date')} />
            </div>
            <div className="field"><label className="label">Currency</label>
              <select className="select" value={form.currency} onChange={set('currency')}>
                <option value="">Functional</option>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </div>
          </div>
        </div></div>

        <div className="card mt-3"><div className="card__body">
          <div className="line-items">
            <table>
              <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Unit price</th><th>Tax code</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td><select className="select" value={l.product} onChange={(e) => setLine(i, 'product', e.target.value)}>
                      <option value="">—</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                    </select></td>
                    <td><input type="number" step="0.001" className="input num" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
                    <td><input type="number" step="0.000001" className="input num" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} /></td>
                    <td><input className="input" value={l.tax_code} onChange={(e) => setLine(i, 'tax_code', e.target.value)} /></td>
                    <td>
                      {lines.length > 1 && (
                        <button type="button" className="row-action row-action--danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><i className="bi bi-x-lg" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="line-items__foot">
              <button type="button" className="btn btn-sm"
                      onClick={() => setLines((ls) => [...ls, { product: '', quantity: '', unit_price: '', tax_code: '' }])}>
                + Add line
              </button>
            </div>
          </div>
          {error && <p className="field-error mt-3" role="alert">{error}</p>}
        </div></div>

        <div className="form-actions">
          <button type="button" className="btn" onClick={() => onCreated(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create invoice'}</button>
        </div>
      </form>
    </div>
  );
}

function EditSI({ id, can, notify, navigate }) {
  const [inv, setInv] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setInv(await api.salesInvoices.get(id)); }
    catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading && !inv) return <div className="app-content"><div className="state-screen">Loading…</div></div>;
  if (error && !inv) return <div className="app-content"><div className="card"><div className="card__body">
    <p className="field-error">{error}</p><button className="btn mt-2" onClick={load}>Try again</button>
  </div></div></div>;
  if (!inv) return null;

  const post = async () => {
    if (!window.confirm(`Post ${inv.reference}?`)) return;
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
          <div className="breadcrumb">
            <button className="breadcrumb__back" onClick={() => navigate(-1)}><i className="bi bi-arrow-left" /></button>
            <span className="breadcrumb__item"><a href="/sales/invoices">Sales invoices</a></span>
            <span className="breadcrumb__item is-current"><span>{inv.reference}</span></span>
          </div>
          <h1 className="page-header__title">
            {inv.reference}
            <span className={`status ${inv.status === 'POSTED' ? 'status-posted' : inv.status === 'PAID' ? 'status-paid' : inv.status === 'CANCELLED' ? 'status-rejected' : inv.status === 'PART_PAID' ? 'status-pending' : 'status-draft'}`}>{inv.status}</span>
          </h1>
          <p className="page-header__subtitle">
            {inv.customer_label || inv.customer} · {fmtMoney(inv.total, inv.currency)} · outstanding {fmtMoney(inv.outstanding)}
          </p>
        </div>
        <div className="page-header__actions">
          {inv.status === 'DRAFT' && can('sales.edit') && (
            <button className="btn btn-primary" onClick={post}>Post</button>
          )}
        </div>
      </header>

      <div className="card"><div className="card__header"><h2 className="card__title">Header</h2></div><div className="card__body">
        <div className="kv">
          <div className="kv__item"><div className="kv__label">Customer</div><div className="kv__value">{inv.customer_label || inv.customer}</div></div>
          <div className="kv__item"><div className="kv__label">Invoice date</div><div className="kv__value">{inv.invoice_date}</div></div>
          <div className="kv__item"><div className="kv__label">Due date</div><div className="kv__value">{inv.due_date || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Sales order</div><div className="kv__value">{inv.sales_order_label || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Currency</div><div className="kv__value">{inv.currency || 'functional'}</div></div>
          <div className="kv__item"><div className="kv__label">Exchange rate</div><div className="kv__value">{inv.exchange_rate || '—'}</div></div>
        </div>
      </div></div>

      <div className="card mt-3"><div className="card__header"><h2 className="card__title">Lines</h2></div><div className="card__body card__body--flush">
        <table className="table table--compact">
          <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Tax</th><th className="num">Total</th></tr></thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.product_label || l.product}</td>
                <td className="num">{Number(l.quantity).toLocaleString()}</td>
                <td className="num">{Number(l.unit_price).toFixed(6)}</td>
                <td className="num">{fmtMoney(l.tax_amount)}</td>
                <td className="num">{fmtMoney(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4}>Subtotal</td><td className="num">{fmtMoney(inv.subtotal)}</td></tr>
            <tr><td colSpan={4}>Tax</td><td className="num">{fmtMoney(inv.tax_total)}</td></tr>
            <tr><td colSpan={4}><strong>Total</strong></td><td className="num"><strong>{fmtMoney(inv.total)}</strong></td></tr>
          </tfoot>
        </table>
      </div></div>
    </div>
  );
}