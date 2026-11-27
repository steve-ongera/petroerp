/**
 * Sales order detail (create, view and edit).
 * - POST   /sales-orders/                  create with lines + pricing method per line
 * - PUT    /sales-orders/:id/              edit (server allows this only while the order is DRAFT;
 *                                          lines are replaced and apply_line_pricing runs again)
 * - DELETE /sales-orders/:id/              delete a DRAFT order
 * - POST   /sales-orders/:id/reserve/  { depot }   -> creates StockReservation rows
 * - POST   /sales-orders/:id/submit/
 * - POST   /sales-orders/:id/cancel/
 * - POST   /approvals/:requestId/approve/ | reject/  { comment }  (the order's pending approval request)
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
  if (n == null || n === '') return '\u2014';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyLine = () => ({
  product: '', quantity: '', pricing_method: 'FIXED',
  unit_price: '', base_price: '', premium: '', target_margin_pct: '',
  tax_code: '', tax_rate: '',
});

/** Zero / null from the server means "not set" for these optional price fields. */
const nz = (v) => (v == null || v === '' || Number(v) === 0 ? '' : String(v));

/** Turn a saved order line into the shape the edit form works with. */
const lineFromApi = (l) => ({
  product: l.product != null ? String(l.product) : '',
  quantity: l.quantity != null ? String(l.quantity) : '',
  pricing_method: l.pricing_method || 'FIXED',
  unit_price: l.pricing_method === 'FIXED' && l.unit_price != null ? String(l.unit_price) : '',
  base_price: nz(l.base_price),
  premium: nz(l.premium),
  target_margin_pct: l.target_margin_pct == null ? '' : String(l.target_margin_pct),
  tax_code: l.tax_code || '',
  tax_rate: l.tax_rate != null && l.tax_code ? String(l.tax_rate) : '',
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

/* ---------------------------------------------------------------- shared order form (create + edit) */

/**
 * `initial` = a saved order -> edit mode (PUT). No `initial` -> create mode (POST).
 * The legal entity cannot be changed on an existing order (its customer and prices depend on it).
 */
function OrderForm({ initial, onSaved, onCancel }) {
  const isEdit = Boolean(initial);
  const { user } = useAuth();
  const { companyParams, notify } = useApp();
  const companies = user?.companies || [];

  // The server requires a company. With "All entities" selected there is none, so the user picks it here.
  const [company, setCompany] = useState(() => (isEdit
    ? String(initial.company)
    : String(companyParams().company || (companies.length === 1 ? companies[0].id : ''))));
  const [currencies, setCurrencies] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(() => (isEdit ? {
    customer: initial.customer != null ? String(initial.customer) : '',
    order_date: initial.order_date || todayISO(),
    required_date: initial.required_date || '',
    delivery_location: initial.delivery_location || '',
    delivery_terms: initial.delivery_terms || '',
    currency: initial.currency || '',
  } : {
    customer: '', order_date: todayISO(), required_date: '',
    delivery_location: '', delivery_terms: '', currency: '',
  }));
  const [lines, setLines] = useState(() => (isEdit && initial.lines?.length ? initial.lines.map(lineFromApi) : [emptyLine()]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  useEffect(() => {
    Promise.all([api.products.listAll(), api.currencies.listAll()])
      .then(([p, c]) => { setProducts(p); setCurrencies(c); })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  // Customers belong to one legal entity.
  useEffect(() => {
    setCustomers([]);
    if (!company) return undefined;
    let alive = true;
    api.customers.listAll({ company, status: 'ACTIVE' })
      .then((c) => { if (alive) setCustomers(c); })
      .catch((err) => { if (alive) setError(errorMessage(err)); });
    return () => { alive = false; };
  }, [company]);

  const changeCompany = (e) => {
    setCompany(e.target.value);
    setForm((f) => ({ ...f, customer: '', currency: '' }));
  };

  /** Picking a customer fills in their currency and payment terms (both can be changed). */
  const pickCustomer = (e) => {
    const value = e.target.value;
    const c = customers.find((x) => String(x.id) === value);
    setForm((f) => ({
      ...f, customer: value,
      currency: c?.currency || '',
      delivery_terms: f.delivery_terms || c?.payment_terms || '',
    }));
  };

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFieldErr({});
    if (!company) { setError('Select the legal entity.'); return; }
    const used = lines.filter((l) => l.product || l.quantity);
    if (!used.length || used.some((l) => !l.product || !(Number(l.quantity) > 0))) {
      setError('Every line needs a product and a quantity above zero.'); return;
    }
    if (used.some((l) => l.pricing_method === 'FIXED' && !(Number(l.unit_price) > 0))) {
      setError('Enter a price for every FIXED line.'); return;
    }
    if (used.some((l) => l.pricing_method === 'COST_PLUS' && l.target_margin_pct === '')) {
      setError('Enter a target margin for every COST PLUS line.'); return;
    }
    setBusy(true);
    try {
      const body = {
        ...form, company: Number(company),
        lines: used.map((l) => ({
          product: l.product, quantity: l.quantity,
          pricing_method: l.pricing_method,
          ...(l.pricing_method === 'FIXED' ? { unit_price: l.unit_price } : {}),
          ...(l.pricing_method === 'MARKET' && l.base_price ? { base_price: l.base_price } : {}),
          ...(l.pricing_method === 'MARKET' && l.premium ? { premium: l.premium } : {}),
          ...(l.pricing_method === 'COST_PLUS' ? { target_margin_pct: l.target_margin_pct } : {}),
          // keep the tax settings of lines that were already saved with one
          ...(l.tax_code ? { tax_code: l.tax_code, ...(l.tax_rate !== '' ? { tax_rate: l.tax_rate } : {}) } : {}),
        })),
      };

      let so;
      if (isEdit) {
        const newCurrency = form.currency || null;
        body.required_date = form.required_date || null;
        body.currency = newCurrency;
        // The booked exchange rate belongs to the old currency; clear it so the server fetches the new one.
        if (newCurrency !== (initial.currency || null)) body.exchange_rate = null;
        so = await api.salesOrders.update(initial.id, body);
        notify('Sales order updated.', 'success');
      } else {
        ['required_date', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
        so = await api.salesOrders.create(body);
        notify('Sales order created.', 'success');
      }
      onSaved(so);
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  // An edited order may point at a customer who is no longer ACTIVE; keep them selectable.
  const customerMissing = form.customer && !customers.some((c) => String(c.id) === String(form.customer));

  return (
    <>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <form onSubmit={submit}>
        <section className="page-card">
          <SectionHeader first icon="bi-card-text" title="Order Details" />
          <SectionBody>
            <div className="form-grid">
              <Field label="Legal entity" required err={fieldErr.company}>
                <select className="form-select" value={company} onChange={changeCompany} required disabled={isEdit}>
                  <option value="">&mdash;</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.code} &middot; {c.name}</option>)}
                </select>
              </Field>
              <Field label="Customer" required err={fieldErr.customer}>
                <select className="form-select" value={form.customer} onChange={pickCustomer} required disabled={!company}>
                  <option value="">{company ? '\u2014' : 'Select the legal entity first'}</option>
                  {customerMissing && (
                    <option value={form.customer}>{initial?.customer_label || `Customer #${form.customer}`}</option>
                  )}
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.code} &middot; {c.name}</option>)}
                </select>
              </Field>
              <Field label="Currency" err={fieldErr.currency}>
                <select className="form-select" value={form.currency} onChange={set('currency')}>
                  <option value="">Company currency</option>
                  {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="Order date" required err={fieldErr.order_date}>
                <input type="date" className="form-control" value={form.order_date} onChange={set('order_date')} required />
              </Field>
              <Field label="Required date" err={fieldErr.required_date}>
                <input type="date" className="form-control" value={form.required_date} onChange={set('required_date')} />
              </Field>
              <Field label="Delivery location" err={fieldErr.delivery_location}>
                <input className="form-control" value={form.delivery_location} onChange={set('delivery_location')} />
              </Field>
              <Field label="Terms" err={fieldErr.delivery_terms}>
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
                          <option value="">&mdash;</option>
                          {products.map((p) => <option key={p.id} value={p.id}>{p.code} &middot; {p.name}</option>)}
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
              {isEdit && ' Saving replaces all lines and recalculates cost, margin and totals.'}
            </p>
          </SectionBody>
        </section>

        <div className="d-flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save changes' : 'Create order')}
          </button>
        </div>
      </form>
    </>
  );
}

/* ---------------------------------------------------------------- create */

function CreateSO({ onCreated, onCancel }) {
  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
         
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

      <OrderForm onSaved={onCreated} onCancel={onCancel} />
    </div>
  );
}

/* ---------------------------------------------------------------- edit / view */

function EditSO({ id }) {
  const { can, user } = useAuth();
  const { notify } = useApp();
  const navigate = useNavigate();
  const [so, setSo] = useState(null);
  const [depots, setDepots] = useState([]);
  const [reserving, setReserving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [approval, setApproval] = useState(null);       // pending approval request for this order
  const [needRole, setNeedRole] = useState('');         // role name required by the approval policy
  const [approvalError, setApprovalError] = useState('');
  const [actionError, setActionError] = useState('');
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const o = await api.salesOrders.get(id);
      const d = await api.depots.listAll({ company: o.company });   // only this order's depots
      setSo(o); setDepots(d);

      setApproval(null); setNeedRole(''); setApprovalError('');
      if (o.status === 'AWAITING_APPROVAL') {
        try {
          const requests = await api.approvals.listAll({ company: o.company, doc_type: 'SalesOrder', status: 'PENDING' });
          const req = requests.find((r) => String(r.object_id) === String(o.id));
          if (!req) { setApprovalError('No pending approval request was found for this order.'); }
          else {
            // Same rule as the server: the policy with the highest minimum amount that this order reaches.
            try {
              const policies = await api.approvalPolicies.listAll({ company: o.company });
              const policy = policies
                .filter((x) => String(x.company) === String(o.company) && x.doc_type === 'SalesOrder'
                  && Number(x.min_amount) <= Number(req.amount))
                .sort((a, b) => Number(b.min_amount) - Number(a.min_amount))[0];
              setNeedRole(policy?.approver_role_label || '');
            } catch { /* the server still enforces the policy */ }
            setApproval(req);
          }
        } catch (err) { setApprovalError(`Could not load the approval request: ${errorMessage(err)}`); }
      }
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [id]);

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

  const canEditOrder = so.status === 'DRAFT' && can('sales.edit');

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
  const remove = async () => {
    if (!window.confirm(`Delete draft ${so.reference}? This cannot be undone.`)) return;
    try {
      await api.salesOrders.remove(so.id);
      notify('Draft deleted.', 'success');
      navigate('/sales/orders', { replace: true });
    } catch (err) { notify(errorMessage(err), 'error'); }
  };
  const reserve = async (depot) => {
    try { await api.salesOrders.reserve(so.id, depot); notify('Stock reserved.', 'success'); load(); }
    catch (err) { notify(errorMessage(err), 'error'); }
    finally { setReserving(false); }
  };

  /* ---- editing: swap the read-only sections for the form */
  if (editing) {
    return (
      <div>
        <div className="page-header">
          <div className="page-header__lead">
           
            <div className="page-header__text">
              <h1 className="page-title">Edit {so.reference}</h1>
              <p className="page-subtitle">Draft orders can be changed until they are submitted</p>
            </div>
          </div>
          <div className="page-header__actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>
              <i className="bi bi-arrow-left"></i>
              Back to order
            </button>
          </div>
        </div>

        <OrderForm
          initial={so}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
        />
      </div>
    );
  }

  const lines = so.lines || [];

  // Why this user cannot decide ('' = they can). The server checks the same rules again.
  const isAdmin = ['GROUP_ADMIN', 'SUPERUSER'].includes(user?.role);
  let blocked = '';
  if (approval) {
    if (approval.created_by === user?.id) {
      blocked = `You submitted this order, so another user must approve or reject it${needRole ? ` (policy role: ${needRole}, or an admin)` : ''}.`;
    } else if (needRole && !isAdmin && user?.role_name !== needRole) {
      blocked = `Your role is "${user?.role_name || 'No role'}". Only ${needRole} or an admin can approve or reject this order.`;
    }
  }

  const decide = async (approve) => {
    let comment = '';
    if (approve) {
      if (!window.confirm(`Approve ${so.reference} for ${fmtMoney(so.total, so.currency)}?`)) return;
    } else {
      const reason = window.prompt(`Why are you rejecting ${so.reference}?`);
      if (reason === null) return;
      if (!reason.trim()) { setActionError('Enter a reason to reject the order.'); return; }
      comment = reason.trim();
    }
    setDeciding(true); setActionError('');
    try {
      if (approve) await api.approvals.approve(approval.id, comment);
      else await api.approvals.reject(approval.id, comment);
      notify(approve ? 'Order approved.' : 'Order rejected and returned to draft.', 'success');
      await load();
    } catch (err) { setActionError(errorMessage(err)); notify(errorMessage(err), 'error'); }
    finally { setDeciding(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">

          <div className="page-header__text">
            <h1 className="page-title">
              {so.reference}{' '}
              <span className={`status-pill ${orderStatusPill(so.status)}`}>{so.status.replace('_', ' ')}</span>
            </h1>
            <p className="page-subtitle">
              {so.customer_label || so.customer} &middot; {fmtMoney(so.total, so.currency)}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <Link to="/sales/orders" className="btn btn-secondary">
            <i className="bi bi-arrow-left"></i>
            Sales orders
          </Link>
          {canEditOrder && (
            <button className="btn btn-secondary" onClick={() => setEditing(true)}>
              <i className="bi bi-pencil"></i>
              Edit
            </button>
          )}
          {so.status === 'AWAITING_APPROVAL' && (
            <>
              <button className="btn btn-primary" onClick={() => decide(true)}
                      disabled={!approval || !!blocked || deciding} title={blocked || undefined}>
                <i className="bi bi-check-lg"></i>
                {deciding ? 'Working...' : 'Approve'}
              </button>
              <button className="btn btn-secondary" onClick={() => decide(false)}
                      disabled={!approval || !!blocked || deciding} title={blocked || undefined}>
                <i className="bi bi-arrow-counterclockwise"></i>
                Reject
              </button>
            </>
          )}
          {canEditOrder && (
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
          {canEditOrder && (
            <button className="btn btn-outline-danger" onClick={remove}>
              <i className="bi bi-trash"></i>
              Delete
            </button>
          )}
        </div>
      </div>

      {(approvalError || actionError) && (
        <div className="alert alert-danger" role="alert">{actionError || approvalError}</div>
      )}
      {approval && (
        <div className="alert alert-info" role="status">
          <span>
            {blocked || 'This order is waiting for your decision.'}
            {approval.created_by_label ? ` Submitted by ${approval.created_by_label}.` : ''}
          </span>
        </div>
      )}

      <section className="page-card">
        <SectionHeader first icon="bi-info-circle" title="Order Details" />
        <SectionBody>
          <KV items={[
            ['Customer', so.customer_label || so.customer],
            ['Order date', so.order_date],
            ['Required date', so.required_date || '\u2014'],
            ['Delivery location', so.delivery_location || '\u2014'],
            ['Delivery terms', so.delivery_terms || '\u2014'],
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
              <option value="">&mdash;</option>
              {depots.map((d) => <option key={d.id} value={d.id}>{d.code} &middot; {d.name}</option>)}
            </select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}