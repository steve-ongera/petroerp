/**
 * Sales order detail (create or edit).
 * - POST /sales-orders/:id/reserve/  { depot }   → creates StockReservation rows
 * - POST /sales-orders/:id/submit/
 * - POST /sales-orders/:id/cancel/
 * - GET  /shipments/?sales_order=<id> (to view fulfilment)
 *
 * "new" branch → create with lines + pricing method per line
 * (server applies apply_line_pricing and enforces minimum margin).
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
const PRICING = ['FIXED', 'MARKET', 'COST_PLUS'];

export default function SalesOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify, companyParams } = useApp();
  const isNew = id === 'new';

  if (isNew) return <CreateSO onCreated={(so) => navigate(`/sales/orders/${so.id}`, { replace: true })} />;
  return <EditSO id={id} can={can} notify={notify} companyParams={companyParams} navigate={navigate} />;
}

function CreateSO({ onCreated }) {
  const { companyParams, notify } = useApp();
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [depots, setDepots] = useState([]);
  const [form, setForm] = useState({
    customer: '', order_date: todayISO(), required_date: '',
    delivery_location: '', delivery_terms: '',
  });
  const [lines, setLines] = useState([{ product: '', quantity: '', pricing_method: 'FIXED', unit_price: '', base_price: '', premium: '', target_margin_pct: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  useEffect(() => {
    Promise.all([
      api.customers.listAll({ ...companyParams(), status: 'ACTIVE' }),
      api.products.listAll(),
      api.depots.listAll({ ...companyParams() }),
    ]).then(([c, p, d]) => { setCustomers(c); setProducts(p); setDepots(d); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = {
        ...form, company: companyParams().company,
        lines: lines.filter((l) => l.product && l.quantity).map((l) => ({
          product: l.product, quantity: l.quantity,
          pricing_method: l.pricing_method,
          ...(l.unit_price ? { unit_price: l.unit_price } : {}),
          ...(l.base_price ? { base_price: l.base_price } : {}),
          ...(l.premium ? { premium: l.premium } : {}),
          ...(l.target_margin_pct ? { target_margin_pct: l.target_margin_pct } : {}),
        })),
      };
      ['required_date'].forEach((k) => { if (!body[k]) delete body[k]; });
      const so = await api.salesOrders.create(body);
      notify('Sales order created.', 'success');
      onCreated(so);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="app-content">
      <header className="page-header"><div className="page-header__main">
        <h1 className="page-header__title">New sales order</h1>
      </div></header>
      <form onSubmit={submit}>
        <div className="card"><div className="card__body">
          <div className="form-grid form-grid--3">
            <div className="field">
              <label className="label label--required">Customer</label>
              <select className="select" value={form.customer} onChange={set('customer')} required>
                <option value="">—</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label label--required">Order date</label>
              <input type="date" className="input" value={form.order_date} onChange={set('order_date')} required />
            </div>
            <div className="field">
              <label className="label">Required date</label>
              <input type="date" className="input" value={form.required_date} onChange={set('required_date')} />
            </div>
            <div className="field span-2"><label className="label">Delivery location</label>
              <input className="input" value={form.delivery_location} onChange={set('delivery_location')} /></div>
            <div className="field"><label className="label">Terms</label>
              <input className="input" value={form.delivery_terms} onChange={set('delivery_terms')} /></div>
          </div>
        </div></div>

        <div className="card mt-3"><div className="card__body">
          <div className="line-items">
            <table>
              <thead><tr>
                <th>Product</th><th className="num">Qty</th><th>Pricing</th>
                <th className="num">Fixed / base price</th><th className="num">Premium</th>
                <th className="num">Target margin %</th><th />
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select className="select" value={l.product} onChange={(e) => setLine(i, 'product', e.target.value)}>
                        <option value="">—</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                      </select>
                    </td>
                    <td><input type="number" step="0.001" className="input num" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
                    <td>
                      <select className="select" value={l.pricing_method} onChange={(e) => setLine(i, 'pricing_method', e.target.value)}>
                        {PRICING.map((p) => <option key={p} value={p}>{p.replace('_', ' ')}</option>)}
                      </select>
                    </td>
                    <td>
                      {l.pricing_method === 'FIXED'
                        ? <input type="number" step="0.000001" className="input num" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} />
                        : <input type="number" step="0.000001" className="input num" value={l.base_price} onChange={(e) => setLine(i, 'base_price', e.target.value)} disabled={l.pricing_method === 'COST_PLUS'} />}
                    </td>
                    <td><input type="number" step="0.000001" className="input num" value={l.premium} onChange={(e) => setLine(i, 'premium', e.target.value)} disabled={l.pricing_method !== 'MARKET'} /></td>
                    <td><input type="number" step="0.001" className="input num" value={l.target_margin_pct} onChange={(e) => setLine(i, 'target_margin_pct', e.target.value)} disabled={l.pricing_method !== 'COST_PLUS'} /></td>
                    <td>
                      {lines.length > 1 && (
                        <button type="button" className="row-action row-action--danger"
                                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                          <i className="bi bi-x-lg" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="line-items__foot">
              <button type="button" className="btn btn-sm"
                      onClick={() => setLines((ls) => [...ls, { product: '', quantity: '', pricing_method: 'FIXED', unit_price: '', base_price: '', premium: '', target_margin_pct: '' }])}>
                + Add line
              </button>
            </div>
          </div>
          <p className="field-hint mt-3">
            The server applies <code>apply_line_pricing</code> and blocks margins below the product or company floor
            unless you hold <code>sales.below_margin</code>.
          </p>
          {error && <p className="field-error mt-3" role="alert">{error}</p>}
        </div></div>

        <div className="form-actions">
          <button type="button" className="btn" onClick={() => onCreated(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create order'}</button>
        </div>
      </form>
    </div>
  );
}

function EditSO({ id, can, notify, companyParams, navigate }) {
  const [so, setSo] = useState(null);
  const [depots, setDepots] = useState([]);
  const [reserving, setReserving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [o, d] = await Promise.all([
        api.salesOrders.get(id),
        api.depots.listAll({ ...companyParams() }),
      ]);
      setSo(o); setDepots(d);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [id, companyParams]);

  useEffect(() => { load(); }, [load]);

  if (loading && !so) return <div className="app-content"><div className="state-screen">Loading…</div></div>;
  if (error && !so) return <div className="app-content"><div className="card"><div className="card__body">
    <p className="field-error">{error}</p><button className="btn mt-2" onClick={load}>Try again</button>
  </div></div></div>;
  if (!so) return null;

  const submit = async () => {
    try { const res = await api.salesOrders.submit(so.id); notify(res.approval_request ? 'Sent for approval.' : 'Approved.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const cancel = async () => {
    if (!window.confirm(`Cancel ${so.reference}?`)) return;
    try { await api.salesOrders.cancel(so.id); notify('Cancelled.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };
  const reserve = async (depot) => {
    try { await api.salesOrders.reserve(so.id, depot); notify('Stock reserved.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
    finally { setReserving(false); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <div className="breadcrumb">
            <button className="breadcrumb__back" onClick={() => navigate(-1)}><i className="bi bi-arrow-left" /></button>
            <span className="breadcrumb__item"><a href="/sales/orders">Sales orders</a></span>
            <span className="breadcrumb__item is-current"><span>{so.reference}</span></span>
          </div>
          <h1 className="page-header__title">
            {so.reference}
            <span className={`status ${so.status === 'APPROVED' ? 'status-active' : so.status === 'COMPLETED' ? 'status-closed' : so.status === 'CANCELLED' ? 'status-rejected' : ['AWAITING_APPROVAL', 'IN_FULFILMENT'].includes(so.status) ? 'status-pending' : 'status-draft'}`}>{so.status.replace('_', ' ')}</span>
          </h1>
          <p className="page-header__subtitle">
            {so.customer_label || so.customer} · {fmtMoney(so.total, so.currency)}
          </p>
        </div>
        <div className="page-header__actions">
          {so.status === 'DRAFT' && can('sales.edit') && (
            <button className="btn btn-primary" onClick={submit}>Submit</button>
          )}
          {['APPROVED', 'IN_FULFILMENT'].includes(so.status) && can('sales.edit') && (
            <button className="btn" onClick={() => setReserving(true)}>Reserve stock</button>
          )}
          {['DRAFT', 'AWAITING_APPROVAL', 'APPROVED'].includes(so.status) && can('sales.edit') && (
            <button className="btn btn-danger-outline" onClick={cancel}>Cancel</button>
          )}
        </div>
      </header>

      <div className="card"><div className="card__header"><h2 className="card__title">Header</h2></div><div className="card__body">
        <div className="kv">
          <div className="kv__item"><div className="kv__label">Customer</div><div className="kv__value">{so.customer_label || so.customer}</div></div>
          <div className="kv__item"><div className="kv__label">Order date</div><div className="kv__value">{so.order_date}</div></div>
          <div className="kv__item"><div className="kv__label">Required date</div><div className="kv__value">{so.required_date || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Delivery location</div><div className="kv__value">{so.delivery_location || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Delivery terms</div><div className="kv__value">{so.delivery_terms || '—'}</div></div>
          <div className="kv__item"><div className="kv__label">Currency</div><div className="kv__value">{so.currency || 'functional'}</div></div>
        </div>
      </div></div>

      <div className="card mt-3"><div className="card__header"><h2 className="card__title">Lines</h2></div><div className="card__body card__body--flush">
        <table className="table table--compact">
          <thead><tr>
            <th>Product</th><th className="num">Qty</th><th>Pricing</th>
            <th className="num">Unit price</th><th className="num">Cost / L</th>
            <th className="num">Margin %</th><th className="num">Delivered</th><th className="num">Invoiced</th>
            <th className="num">Line total</th>
          </tr></thead>
          <tbody>
            {so.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.product_label || l.product}</td>
                <td className="num">{Number(l.quantity).toLocaleString()}</td>
                <td><span className="badge">{l.pricing_method}</span></td>
                <td className="num">{Number(l.unit_price).toFixed(6)}</td>
                <td className="num">{Number(l.cost_per_litre || 0).toFixed(6)}</td>
                <td className="num">{Number(l.margin_pct || 0).toFixed(3)}</td>
                <td className="num">{Number(l.delivered_quantity || 0).toLocaleString()}</td>
                <td className="num">{Number(l.invoiced_quantity || 0).toLocaleString()}</td>
                <td className="num">{fmtMoney(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={8}>Subtotal</td><td className="num">{fmtMoney(so.subtotal)}</td></tr>
            <tr><td colSpan={8}>Tax</td><td className="num">{fmtMoney(so.tax_total)}</td></tr>
            <tr><td colSpan={8}><strong>Total</strong></td><td className="num"><strong>{fmtMoney(so.total)}</strong></td></tr>
          </tfoot>
        </table>
      </div></div>

      {reserving && (
        <ReserveModal depots={depots} onClose={() => setReserving(false)} onDone={reserve} />
      )}
    </div>
  );
}

function ReserveModal({ depots, onClose, onDone }) {
  const [depot, setDepot] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">Reserve stock</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <div className="modal__body">
          <div className="field">
            <label className="label label--required">Depot</label>
            <select className="select" value={depot} onChange={(e) => setDepot(e.target.value)}>
              <option value="">—</option>
              {depots.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
            </select>
          </div>
          <p className="field-hint mt-2">Creates StockReservation rows for every order line.</p>
        </div>
        <div className="modal__footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !depot} onClick={async () => { setBusy(true); await onDone(depot); }}>
            {busy ? 'Reserving…' : 'Reserve'}
          </button>
        </div>
      </div>
    </div>
  );
}