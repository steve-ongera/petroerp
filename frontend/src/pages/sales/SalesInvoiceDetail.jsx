/**
 * Sales invoice detail (create or edit).
 * Lines can be attached to a shipment, so invoice quantity is bounded by delivered-and-not-yet-invoiced.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Field from '../../components/Field';
import TableSkeleton from '../../components/TableSkeleton';
import { SectionHeader, SectionBody, KV, EmptyState } from '../../components/PageSection';
import { invoiceStatusPill } from './SalesInvoices';

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyLine = () => ({ product: '', quantity: '', unit_price: '', tax_code: '' });

export default function SalesInvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';

  if (isNew) {
    return (
      <CreateSI
        onCreated={(inv) => navigate(`/sales/invoices/${inv.id}`, { replace: true })}
        onCancel={() => navigate('/sales/invoices')}
      />
    );
  }
  return <EditSI id={id} />;
}

/* ---------------------------------------------------------------- create */

function CreateSI({ onCreated, onCancel }) {
  const { companyParams, notify } = useApp();
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ customer: '', sales_order: '', invoice_date: todayISO(), due_date: '', currency: '' });
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
      api.currencies.listAll(),
    ]).then(([c, p, cur]) => { setCustomers(c); setProducts(p); setCurrencies(cur); }).catch(() => {});
  }, [companyParams]);

  useEffect(() => {
    if (!form.customer) { setOrders([]); return; }
    api.salesOrders.listAll({ ...companyParams(), customer: form.customer, status: 'APPROVED' }).then(setOrders).catch(() => {});
  }, [companyParams, form.customer]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
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
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-receipt-cutoff"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">New sales invoice</h1>
            <p className="page-subtitle">Create a draft invoice, then post it from the invoice page</p>
          </div>
        </div>
        <div className="page-header__actions">
          <Link to="/sales/invoices" className="btn btn-secondary">
            <i className="bi bi-arrow-left"></i>
            Sales invoices
          </Link>
        </div>
      </div>

      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <form onSubmit={submit}>
        <section className="page-card">
          <SectionHeader first icon="bi-card-text" title="Invoice Details" />
          <SectionBody>
            <div className="form-grid">
              <Field label="Customer" required err={fieldErr.customer}>
                <select className="form-select" value={form.customer} onChange={set('customer')} required>
                  <option value="">—</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Sales order" err={fieldErr.sales_order}>
                <select className="form-select" value={form.sales_order} onChange={set('sales_order')}>
                  <option value="">—</option>
                  {orders.map((o) => <option key={o.id} value={o.id}>{o.reference}</option>)}
                </select>
              </Field>
              <Field label="Invoice date" required>
                <input type="date" className="form-control" value={form.invoice_date} onChange={set('invoice_date')} required />
              </Field>
              <Field label="Due date">
                <input type="date" className="form-control" value={form.due_date} onChange={set('due_date')} />
              </Field>
              <Field label="Currency">
                <select className="form-select" value={form.currency} onChange={set('currency')}>
                  <option value="">Functional</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
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
                    <th className="text-right">Unit price</th>
                    <th>Tax code</th>
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
                      <td><input type="number" step="0.000001" className="form-control num" value={l.unit_price} onChange={(e) => setLine(i, 'unit_price', e.target.value)} /></td>
                      <td><input className="form-control" value={l.tax_code} onChange={(e) => setLine(i, 'tax_code', e.target.value)} /></td>
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
        </section>

        <div className="d-flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Creating...' : 'Create invoice'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- edit / view */

function EditSI({ id }) {
  const { can } = useAuth();
  const { notify } = useApp();
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

  if (loading && !inv) {
    return <div><section className="page-card"><TableSkeleton rows={6} columns={5} /></section></div>;
  }
  if (error && !inv) {
    return (
      <div>
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
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

  const lines = inv.lines || [];

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-receipt-cutoff"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">
              {inv.reference}{' '}
              <span className={`status-pill ${invoiceStatusPill(inv.status)}`}>{inv.status.replace('_', ' ')}</span>
            </h1>
            <p className="page-subtitle">
              {inv.customer_label || inv.customer} · {fmtMoney(inv.total, inv.currency)} · outstanding {fmtMoney(inv.outstanding)}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <Link to="/sales/invoices" className="btn btn-secondary">
            <i className="bi bi-arrow-left"></i>
            Sales invoices
          </Link>
          {inv.status === 'DRAFT' && can('sales.edit') && (
            <button className="btn btn-primary" onClick={post}>
              <i className="bi bi-send-check"></i>
              Post
            </button>
          )}
        </div>
      </div>

      <section className="page-card">
        <SectionHeader first icon="bi-info-circle" title="Invoice Details" />
        <SectionBody>
          <KV items={[
            ['Customer', inv.customer_label || inv.customer],
            ['Invoice date', inv.invoice_date],
            ['Due date', inv.due_date || '—'],
            ['Sales order', inv.sales_order_label || '—'],
            ['Currency', inv.currency || 'functional'],
            ['Exchange rate', inv.exchange_rate || '—'],
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
                    <th className="text-right">Unit price</th>
                    <th className="text-right">Tax</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="cell-name">{l.product_label || l.product}</td>
                      <td className="cell-num">{Number(l.quantity).toLocaleString()}</td>
                      <td className="cell-num">{Number(l.unit_price).toFixed(6)}</td>
                      <td className="cell-num">{fmtMoney(l.tax_amount)}</td>
                      <td className="cell-num">{fmtMoney(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={4}>Subtotal</td><td className="cell-num">{fmtMoney(inv.subtotal)}</td></tr>
                  <tr><td colSpan={4}>Tax</td><td className="cell-num">{fmtMoney(inv.tax_total)}</td></tr>
                  <tr><td colSpan={4}><strong>Total</strong></td><td className="cell-num"><strong>{fmtMoney(inv.total)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}