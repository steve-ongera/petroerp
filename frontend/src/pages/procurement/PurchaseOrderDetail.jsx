/**
 * Purchase order detail — header, lines, actions.
 * Endpoints:
 *   /purchase-orders/:id/             (detail + lines)
 *   /purchase-orders/:id/submit/
 *   /purchase-orders/:id/receive/     { line, tank, observed_volume, standardized_volume?, temperature_c?, density?,
 *                                       receipt_date?, delivery_note?, vehicle_reg? }
 *   /purchase-orders/:id/cancel/
 *   /goods-receipts/?purchase_order=  history
 *   /purchase-invoices/?purchase_order=  linked invoices
 *
 * Route can be either .../purchase-orders/:id or .../purchase-orders/new → if no id, show create form.
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

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify, companyParams } = useApp();
  const isNew = id === 'new';

  if (isNew) {
    return <CreatePO onCreated={(po) => navigate(`/procurement/purchase-orders/${po.id}`, { replace: true })} />;
  }
  return <EditPO id={id} navigate={navigate} can={can} notify={notify} companyParams={companyParams} />;
}

/* ------------------------------------------------------------------ create */

function CreatePO({ onCreated }) {
  const { companyParams, notify } = useApp();
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [depots, setDepots] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState({
    supplier: '', order_date: todayISO(), expected_loading_date: '',
    loading_depot: '', delivery_location: '', payment_terms_days: 30, currency: '',
  });
  const [lines, setLines] = useState([{ product: '', quantity: '', unit_price: '', tax_code: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.suppliers.listAll({ ...companyParams(), status: 'ACTIVE' }),
      api.products.listAll(),
      api.depots.listAll({ ...companyParams() }),
      api.currencies.listAll(),
    ]).then(([s, p, d, c]) => { setSuppliers(s); setProducts(p); setDepots(d); setCurrencies(c); }).catch(() => {});
  }, [companyParams]);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = {
        ...form,
        company: companyParams().company,
        lines: lines.filter((l) => l.product && l.quantity && l.unit_price).map((l) => ({
          product: l.product, quantity: l.quantity, unit_price: l.unit_price,
          ...(l.tax_code ? { tax_code: l.tax_code } : {}),
        })),
      };
      ['expected_loading_date', 'loading_depot', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
      const po = await api.purchaseOrders.create(body);
      notify('Purchase order created.', 'success');
      onCreated(po);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">New purchase order</h1>
        </div>
      </header>
      <form onSubmit={submit}>
        <div className="card"><div className="card__body">
          <div className="form-grid form-grid--3">
            <Field label="Supplier" required>
              <select className="select" value={form.supplier} onChange={set('supplier')} required>
                <option value="">—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
              </select>
            </Field>
            <Field label="Order date" required>
              <input type="date" className="input" value={form.order_date} onChange={set('order_date')} required />
            </Field>
            <Field label="Expected loading">
              <input type="date" className="input" value={form.expected_loading_date} onChange={set('expected_loading_date')} />
            </Field>
            <Field label="Loading depot">
              <select className="select" value={form.loading_depot} onChange={set('loading_depot')}>
                <option value="">—</option>
                {depots.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
              </select>
            </Field>
            <Field label="Delivery location"><input className="input" value={form.delivery_location} onChange={set('delivery_location')} /></Field>
            <Field label="Currency">
              <select className="select" value={form.currency} onChange={set('currency')}>
                <option value="">Functional</option>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </Field>
          </div>
        </div></div>

        <div className="card mt-3"><div className="card__body">
          <div className="line-items">
            <table>
              <thead><tr>
                <th>Product</th><th className="num">Quantity</th>
                <th className="num">Unit price</th><th>Tax code</th><th />
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
                    <td><input type="number" step="0.000001" className="input num" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} /></td>
                    <td><input className="input" value={l.tax_code} onChange={(e) => setLine(i, 'tax_code', e.target.value)} /></td>
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
                      onClick={() => setLines((ls) => [...ls, { product: '', quantity: '', unit_price: '', tax_code: '' }])}>
                + Add line
              </button>
            </div>
          </div>
        </div></div>

        {error && <p className="field-error mt-3" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => onCreated(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create PO'}</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ edit */

function EditPO({ id, navigate, can, notify, companyParams }) {
  const [po, setPo] = useState(null);
  const [grns, setGrns] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [receiving, setReceiving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [p, g, i] = await Promise.all([
        api.purchaseOrders.get(id),
        api.goodsReceipts.listAll({ purchase_order: id }).catch(() => []),
        api.purchaseInvoices.listAll({ purchase_order: id }).catch(() => []),
      ]);
      setPo(p); setGrns(g); setInvoices(i);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading && !po) return <div className="app-content"><div className="state-screen">Loading…</div></div>;
  if (error && !po) return <div className="app-content"><div className="card"><div className="card__body">
    <p className="field-error">{error}</p><button className="btn mt-2" onClick={load}>Try again</button>
  </div></div></div>;
  if (!po) return null;

  const submit = async () => {
    try {
      const res = await api.purchaseOrders.submit(po.id);
      notify(res.approval_request ? 'Sent for approval.' : 'Approved.', 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const cancel = async () => {
    if (!window.confirm(`Cancel ${po.reference}?`)) return;
    try { await api.purchaseOrders.cancel(po.id); notify('Cancelled.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
  };

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <div className="breadcrumb">
            <button className="breadcrumb__back" onClick={() => navigate(-1)}><i className="bi bi-arrow-left" /></button>
            <span className="breadcrumb__item"><a href="/procurement/purchase-orders">Purchase orders</a></span>
            <span className="breadcrumb__item is-current"><span>{po.reference}</span></span>
          </div>
          <h1 className="page-header__title">
            {po.reference}
            <span className={`status ${po.status === 'APPROVED' ? 'status-active' : po.status === 'DRAFT' ? 'status-draft' : po.status === 'CANCELLED' ? 'status-rejected' : ['AWAITING_APPROVAL'].includes(po.status) ? 'status-pending' : 'status-posted'}`}>{po.status.replace(/_/g, ' ')}</span>
          </h1>
          <p className="page-header__subtitle">
            {po.supplier_label || po.supplier} · {fmtMoney(po.total, po.currency)}
          </p>
        </div>
        <div className="page-header__actions">
          {po.status === 'DRAFT' && can('procurement.edit') && (
            <button className="btn btn-primary" onClick={submit}>Submit</button>
          )}
          {po.status === 'APPROVED' && can('inventory.edit') && (
            <button className="btn btn-primary" onClick={() => setReceiving(po.lines[0] || null)}>Receive goods</button>
          )}
          {['DRAFT', 'AWAITING_APPROVAL', 'APPROVED'].includes(po.status) && can('procurement.edit') && !grns.length && (
            <button className="btn btn-danger-outline" onClick={cancel}>Cancel</button>
          )}
        </div>
      </header>

      <div className="split split--wide-left">
        <div className="stack">
          <div className="card"><div className="card__header"><h2 className="card__title">Header</h2></div><div className="card__body">
            <div className="kv">
              <div className="kv__item"><div className="kv__label">Supplier</div><div className="kv__value">{po.supplier_label || po.supplier}</div></div>
              <div className="kv__item"><div className="kv__label">Order date</div><div className="kv__value">{po.order_date}</div></div>
              <div className="kv__item"><div className="kv__label">Expected loading</div><div className="kv__value">{po.expected_loading_date || '—'}</div></div>
              <div className="kv__item"><div className="kv__label">Loading depot</div><div className="kv__value">{po.loading_depot_label || '—'}</div></div>
              <div className="kv__item"><div className="kv__label">Currency</div><div className="kv__value">{po.currency || 'functional'}</div></div>
              <div className="kv__item"><div className="kv__label">Exchange rate</div><div className="kv__value">{po.exchange_rate || '—'}</div></div>
              <div className="kv__item"><div className="kv__label">Payment terms</div><div className="kv__value">{po.payment_terms_days} days</div></div>
              <div className="kv__item"><div className="kv__label">Delivery location</div><div className="kv__value">{po.delivery_location || '—'}</div></div>
            </div>
          </div></div>

          <div className="card"><div className="card__header"><h2 className="card__title">Lines</h2></div><div className="card__body card__body--flush">
            <table className="table table--compact">
              <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Received</th><th className="num">Unit price</th><th className="num">Total</th><th>Tax</th></tr></thead>
              <tbody>
                {po.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.product_label || l.product}</td>
                    <td className="num">{Number(l.quantity).toLocaleString()}</td>
                    <td className="num">{Number(l.received_quantity || 0).toLocaleString()}</td>
                    <td className="num">{Number(l.unit_price).toFixed(6)}</td>
                    <td className="num">{fmtMoney(l.line_total)}</td>
                    <td>{l.tax_code || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}>Subtotal</td><td className="num">{fmtMoney(po.subtotal)}</td><td /></tr>
                <tr><td colSpan={4}>Tax</td><td className="num">{fmtMoney(po.tax_total)}</td><td /></tr>
                <tr><td colSpan={4}><strong>Total</strong></td><td className="num"><strong>{fmtMoney(po.total)}</strong></td><td /></tr>
              </tfoot>
            </table>
          </div></div>
        </div>

        <div className="stack">
          <div className="card"><div className="card__header"><h2 className="card__title">Goods receipts</h2></div><div className="card__body card__body--flush">
            {!grns.length ? <div className="table-empty"><div className="table-empty__title">No receipts yet</div></div> : (
              <table className="table table--compact">
                <thead><tr><th>Reference</th><th>Date</th><th className="num">Qty</th><th>Status</th></tr></thead>
                <tbody>
                  {grns.map((g) => (
                    <tr key={g.id}><td className="mono">{g.reference}</td><td>{g.receipt_date}</td>
                      <td className="num">{Number(g.quantity).toLocaleString()}</td>
                      <td><span className="status status-posted">{g.status}</span></td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div></div>

          <div className="card"><div className="card__header"><h2 className="card__title">Invoices</h2></div><div className="card__body card__body--flush">
            {!invoices.length ? <div className="table-empty"><div className="table-empty__title">No invoices yet</div></div> : (
              <table className="table table--compact">
                <thead><tr><th>Reference</th><th>Invoice #</th><th className="num">Total</th><th>Status</th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}><td className="mono">{i.reference}</td><td className="mono">{i.supplier_invoice_no}</td>
                      <td className="num">{fmtMoney(i.total)}</td>
                      <td><span className={`status ${i.status === 'POSTED' ? 'status-posted' : 'status-draft'}`}>{i.status}</span></td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div></div>
        </div>
      </div>

      {receiving && (
        <ReceiveModal po={po} line={receiving} onClose={() => setReceiving(null)}
                      onDone={() => { setReceiving(null); notify('Goods received.', 'success'); load(); }} />
      )}
    </div>
  );
}

function ReceiveModal({ po, line, onClose, onDone }) {
  const [tanks, setTanks] = useState([]);
  const [form, setForm] = useState({
    line: line?.id || '', tank: '', observed_volume: '',
    standardized_volume: '', temperature_c: '', density: '',
    receipt_date: todayISO(), delivery_note: '', vehicle_reg: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => { api.storageTanks.listAll({ company: po.company }).then(setTanks).catch(() => {}); }, [po.company]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = { ...form };
      ['standardized_volume', 'temperature_c', 'density'].forEach((k) => { if (!body[k]) delete body[k]; });
      await api.purchaseOrders.receive(po.id, body);
      onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog">
        <div className="modal__header">
          <h2 className="modal__title">Receive goods</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid">
              <Field label="Line" required span>
                <select className="select" value={form.line} onChange={set('line')} required>
                  <option value="">—</option>
                  {po.lines.map((l) => <option key={l.id} value={l.id}>
                    {l.product_label || l.product} · ordered {Number(l.quantity).toLocaleString()} · received {Number(l.received_quantity || 0).toLocaleString()}
                  </option>)}
                </select>
              </Field>
              <Field label="Tank" required>
                <select className="select" value={form.tank} onChange={set('tank')} required>
                  <option value="">—</option>
                  {tanks.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              </Field>
              <Field label="Receipt date" required>
                <input type="date" className="input" value={form.receipt_date} onChange={set('receipt_date')} required />
              </Field>
              <Field label="Observed volume (L)" required>
                <input type="number" step="0.001" className="input num" value={form.observed_volume} onChange={set('observed_volume')} required />
              </Field>
              <Field label="Standardized volume (L)">
                <input type="number" step="0.001" className="input num" value={form.standardized_volume} onChange={set('standardized_volume')} />
              </Field>
              <Field label="Temperature (°C)">
                <input type="number" step="0.01" className="input num" value={form.temperature_c} onChange={set('temperature_c')} />
              </Field>
              <Field label="Density">
                <input type="number" step="0.0001" className="input num" value={form.density} onChange={set('density')} />
              </Field>
              <Field label="Delivery note"><input className="input" value={form.delivery_note} onChange={set('delivery_note')} /></Field>
              <Field label="Vehicle reg"><input className="input mono" value={form.vehicle_reg} onChange={set('vehicle_reg')} /></Field>
            </div>
            <p className="field-hint mt-3">
              Stock will move into the tank at the PO unit price × exchange rate. GRNI is credited until the invoice is posted.
            </p>
            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Receiving…' : 'Receive'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, span, children }) {
  return (
    <div className={`field ${span ? 'span-all' : ''}`}>
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
    </div>
  );
}