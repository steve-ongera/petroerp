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
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import TableSkeleton from '../../components/TableSkeleton';
import { SectionHeader, SectionBody, KV, EmptyState } from '../../components/PageSection';
import { orderStatusPill } from './SalesOrders';

const PRICING = ['FIXED', 'MARKET', 'COST_PLUS'];
const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyLine = () => ({
  product: '', quantity: '', pricing_method: 'FIXED',
  unit_price: '', base_price: '', premium: '', target_margin_pct: '',
});

export default function SalesOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';

  if (isNew) {
    return (
      <CreateSO
        onCreated={(so) => navigate(`/sales/orders/${so.id}`, { replace: true })}
        onCancel={() => navigate('/sales/orders')}
      />
    );
  }
  return <EditSO id={id} />;
}

/* ---------------------------------------------------------------- create */

function CreateSO({ onCreated, onCancel }) {
  const { companyParams, notify } = useApp();
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    customer: '', order_date: todayISO(), required_date: '',
    delivery_location: '', delivery_terms: '',
  });
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  useEffect(() => {
    Promise.all([
      api.customers.listAll({ ...companyParams(), status: 'ACTIVE' }),
      api.products.listAll(),
    ]).then(([c, p]) => { setCustomers(c); setProducts(p); }).catch(() => {});
  }, [companyParams]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
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
      if (!body.required_date) delete body.required_date;
      const so = await api.salesOrders.create(body);
      notify('Sales order created.', 'success');
      onCreated(so);
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-cart-plus"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">New sales order</h1>
            <p className="page-subtitle">Pricing is applied per line when the order is saved</p>
          </div>
        </div>
        <div className="page-header__actions">
          <Link to="/sales/orders" className="btn btn-secondary">
            <i className="bi bi-arrow-left"></i>
            Sales orders
          </Link>
        </div>
      </div>

      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <form onSubmit={submit}>
        <section className="page-card">
          <SectionHeader first icon="bi-card-text" title="Order Details" />
          <SectionBody>
            <div className="form-grid">
              <Field label="Customer" required err={fieldErr.customer}>
                <select className="form-select" value={form.customer} onChange={set('customer')} required>
                  <option value="">—</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Order date" required>
                <input type="date" className="form-control" value={form.order_date} onChange={set('order_date')} required />
              </Field>
              <Field label="Required date">
                <input type="date" className="form-control" value={form.required_date} onChange={set('required_date')} />
              </Field>
              <Field label="Delivery location">
                <input className="form-control" value={form.delivery_location} onChange={set('delivery_location')} />
              </Field>
              <Field label="Terms">
                <input className="form-control" value={form.delivery_terms} onChange={set('delivery_terms')} />
              </Field>
            </div>
          </SectionBody>
        </section>

        <section className="page-card">
          <SectionHeader first icon="bi-droplet-half" title="Lines" subtitle={`${lines.length} line${lines.length !== 1 ? 's' : ''}`}>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              <i className="bi bi-plus-lg"></i> Add line
            </button>
          </SectionHeader>
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table mb-0">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th>Pricing</th>
                    <th className="text-right">Fixed / base price</th>
                    <th className="text-right">Premium</th>
                    <th className="text-right">Target margin %</th>
                    <th style={{ width: '3rem' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <select className="form-select" value={l.product} onChange={(e) => setLine(i, 'product', e.target.value)}>
                          <option value="">—</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                        </select>
                      </td>
                      <td><input type="number" step="0.001" className="form-control num" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
                      <td>
                        <select className="form-select" value={l.pricing_method} onChange={(e) => setLine(i, 'pricing_method', e.target.value)}>
                          {PRICING.map((p) => <option key={p} value={p}>{p.replace('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td>
                        {l.pricing_method === 'FIXED' ? (
                          <input type="number" step="0.000001" className="form-control num" value={l.unit_price}
                                 onChange={(e) => setLine(i, 'unit_price', e.target.value)} />
                        ) : (
                          <input type="number" step="0.000001" className="form-control num" value={l.base_price}
                                 onChange={(e) => setLine(i, 'base_price', e.target.value)} disabled={l.pricing_method === 'COST_PLUS'} />
                        )}
                      </td>
                      <td>
                        <input type="number" step="0.000001" className="form-control num" value={l.premium}
                               onChange={(e) => setLine(i, 'premium', e.target.value)} disabled={l.pricing_method !== 'MARKET'} />
                      </td>
                      <td>
                        <input type="number" step="0.001" className="form-control num" value={l.target_margin_pct}
                               onChange={(e) => setLine(i, 'target_margin_pct', e.target.value)} disabled={l.pricing_method !== 'COST_PLUS'} />
                      </td>
                      <td>
                        {lines.length > 1 && (
                          <button type="button" className="btn btn-icon" title="Remove line" aria-label="Remove line"
                                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                            <i className="bi bi-x-lg"></i>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <SectionBody>
            <p className="text-muted-soft" style={{ fontSize: '0.8125rem', margin: 0 }}>
              The server applies <code>apply_line_pricing</code> and blocks margins below the product or company floor
              unless you hold <code>sales.below_margin</code>.
            </p>
          </SectionBody>
        </section>

        <div className="d-flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Creating...' : 'Create order'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- edit / view */

function EditSO({ id }) {
  const { can } = useAuth();
  const { notify, companyParams } = useApp();
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

  if (loading && !so) {
    return <div><section className="page-card"><TableSkeleton rows={6} columns={6} /></section></div>;
  }
  if (error && !so) {
    return (
      <div>
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (!so) return null;

  const submit = async () => {
    try {
      const res = await api.salesOrders.submit(so.id);
      notify(res.approval_request ? 'Sent for approval.' : 'Approved.', 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
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

  const lines = so.lines || [];

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-cart-check"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">
              {so.reference}{' '}
              <span className={`status-pill ${orderStatusPill(so.status)}`}>{so.status.replace('_', ' ')}</span>
            </h1>
            <p className="page-subtitle">
              {so.customer_label || so.customer} · {fmtMoney(so.total, so.currency)}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <Link to="/sales/orders" className="btn btn-secondary">
            <i className="bi bi-arrow-left"></i>
            Sales orders
          </Link>
          {so.status === 'DRAFT' && can('sales.edit') && (
            <button className="btn btn-primary" onClick={submit}>
              <i className="bi bi-send"></i>
              Submit
            </button>
          )}
          {['APPROVED', 'IN_FULFILMENT'].includes(so.status) && can('sales.edit') && (
            <button className="btn btn-primary" onClick={() => setReserving(true)}>
              <i className="bi bi-box-seam"></i>
              Reserve stock
            </button>
          )}
          {['DRAFT', 'AWAITING_APPROVAL', 'APPROVED'].includes(so.status) && can('sales.edit') && (
            <button className="btn btn-outline-danger" onClick={cancel}>
              <i className="bi bi-x-circle"></i>
              Cancel
            </button>
          )}
        </div>
      </div>

      <section className="page-card">
        <SectionHeader first icon="bi-info-circle" title="Order Details" />
        <SectionBody>
          <KV items={[
            ['Customer', so.customer_label || so.customer],
            ['Order date', so.order_date],
            ['Required date', so.required_date || '—'],
            ['Delivery location', so.delivery_location || '—'],
            ['Delivery terms', so.delivery_terms || '—'],
            ['Currency', so.currency || 'functional'],
          ]} />
        </SectionBody>
      </section>

      <section className="page-card">
        <SectionHeader first icon="bi-list-ul" title="Lines" subtitle={`${lines.length} line${lines.length !== 1 ? 's' : ''}`} />
        {!lines.length ? (
          <EmptyState icon="bi-droplet" title="No lines" />
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th>Pricing</th>
                    <th className="text-right">Unit price</th>
                    <th className="text-right">Cost / L</th>
                    <th className="text-right">Margin %</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Invoiced</th>
                    <th className="text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="cell-name">{l.product_label || l.product}</td>
                      <td className="cell-num">{Number(l.quantity).toLocaleString()}</td>
                      <td><span className="badge badge-neutral">{String(l.pricing_method).replace('_', ' ')}</span></td>
                      <td className="cell-num">{Number(l.unit_price).toFixed(6)}</td>
                      <td className="cell-num">{Number(l.cost_per_litre || 0).toFixed(6)}</td>
                      <td className="cell-num">{Number(l.margin_pct || 0).toFixed(3)}</td>
                      <td className="cell-num">{Number(l.delivered_quantity || 0).toLocaleString()}</td>
                      <td className="cell-num">{Number(l.invoiced_quantity || 0).toLocaleString()}</td>
                      <td className="cell-num">{fmtMoney(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={8}>Subtotal</td><td className="cell-num">{fmtMoney(so.subtotal)}</td></tr>
                  <tr><td colSpan={8}>Tax</td><td className="cell-num">{fmtMoney(so.tax_total)}</td></tr>
                  <tr><td colSpan={8}><strong>Total</strong></td><td className="cell-num"><strong>{fmtMoney(so.total)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </section>

      {reserving && <ReserveModal depots={depots} onClose={() => setReserving(false)} onDone={reserve} />}
    </div>
  );
}

function ReserveModal({ depots, onClose, onDone }) {
  const [depot, setDepot] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await onDone(depot); // parent closes the modal when finished
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Reserve stock"
      subtitle="Creates StockReservation rows for every order line"
      icon="bi-box-seam"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="reserveForm" disabled={busy || !depot}>
            <i className="bi bi-check-lg"></i>
            {busy ? 'Reserving...' : 'Reserve'}
          </button>
        </>
      }
    >
      <form id="reserveForm" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Depot" required span>
            <select className="form-select" value={depot} onChange={(e) => setDepot(e.target.value)} required>
              <option value="">—</option>
              {depots.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
            </select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}