/**
 * Purchase order detail — header, lines, actions.
 * Endpoints:
 *   /purchase-orders/:id/             (detail + lines, PUT while DRAFT)
 *   /purchase-orders/:id/submit/
 *   /purchase-orders/:id/receive/     { line, tank, observed_volume, standardized_volume?, temperature_c?, density?,
 *                                       receipt_date?, delivery_note?, vehicle_reg? }
 *   /purchase-orders/:id/cancel/
 *   /purchase-requisitions/?status=APPROVED   (requisition picker on the create form)
 *
 * Route can be either .../purchase-orders/:id or .../purchase-orders/new → if no id, show create form.
 *
 * The same form (POForm) is used to create a PO and to edit one that is still DRAFT.
 * On create, an APPROVED requisition can be picked: its company, product, quantity and required date
 * pre-fill the form, and everything stays editable. The server marks the requisition CONVERTED on save.
 * The company is always sent explicitly and cannot be changed once the PO exists.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import TableSkeleton from '../../components/TableSkeleton';
import { SectionHeader, SectionBody, KV, EmptyState } from '../../components/PageSection';
import { poStatusPill } from './PurchaseOrders';

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyLine = () => ({ product: '', quantity: '', unit_price: '', tax_code: '' });

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';

  if (isNew) {
    return (
      <POForm
        onSaved={(po) => navigate(`/procurement/purchase-orders/${po.id}`, { replace: true })}
        onCancel={() => navigate('/procurement/purchase-orders')}
      />
    );
  }
  return <EditPO id={id} />;
}

/* ------------------------------------------------------------------ create / edit form */

function POForm({ po, onSaved, onCancel }) {
  const isEdit = Boolean(po);
  const { user } = useAuth();
  const { companyParams, notify } = useApp();

  const myCompanies = user?.companies || [];
  const initialCompany = () => {
    if (isEdit) return String(po.company);
    const selected = companyParams()?.company;
    if (selected) return String(selected);
    if (myCompanies.length === 1) return String(myCompanies[0].id);
    return '';
  };

  const [company, setCompany] = useState(initialCompany);
  const [requisition, setRequisition] = useState('');
  const [requisitions, setRequisitions] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [depots, setDepots] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [form, setForm] = useState(() => (isEdit ? {
    supplier: String(po.supplier ?? ''),
    order_date: po.order_date || todayISO(),
    expected_loading_date: po.expected_loading_date || '',
    loading_depot: po.loading_depot ? String(po.loading_depot) : '',
    delivery_location: po.delivery_location || '',
    payment_terms_days: po.payment_terms_days ?? 30,
    currency: po.currency || '',
  } : {
    supplier: '', order_date: todayISO(), expected_loading_date: '',
    loading_depot: '', delivery_location: '', payment_terms_days: 30, currency: '',
  }));
  const [lines, setLines] = useState(() => (isEdit && (po.lines || []).length
    ? po.lines.map((l) => ({
      product: String(l.product), quantity: l.quantity, unit_price: l.unit_price, tax_code: l.tax_code || '',
    }))
    : [emptyLine()]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // If the user's company list arrives after first render, pick the default then (create only).
  useEffect(() => {
    if (!isEdit && !company) setCompany(initialCompany());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Products and currencies are global; suppliers and depots belong to the chosen company.
  useEffect(() => {
    Promise.all([api.products.listAll(), api.currencies.listAll()])
      .then(([p, c]) => { setProducts(p); setCurrencies(c); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!company) { setSuppliers([]); setDepots([]); return; }
    Promise.all([
      api.suppliers.listAll({ company, status: 'ACTIVE' }),
      api.depots.listAll({ company }),
    ]).then(([s, d]) => { setSuppliers(s); setDepots(d); }).catch(() => {});
    // a supplier/depot from another company is no longer valid (company is locked when editing)
    if (!isEdit) setForm((f) => ({ ...f, supplier: '', loading_depot: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  // Approved requisitions that can still be turned into a PO (create only).
  // With no company chosen yet, every approved requisition the user can access is listed.
  useEffect(() => {
    if (isEdit) return;
    api.purchaseRequisitions.listAll({ status: 'APPROVED', ...(company ? { company } : {}) })
      .then(setRequisitions)
      .catch(() => setRequisitions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const changeCompany = (value) => {
    setCompany(value);
    // a requisition from another company no longer applies
    const picked = requisitions.find((r) => String(r.id) === String(requisition));
    if (picked && String(picked.company) !== String(value)) setRequisition('');
  };

  const pickRequisition = (value) => {
    if (!value) { setRequisition(''); return; }
    const r = requisitions.find((x) => String(x.id) === String(value));
    if (!r) return;
    const dirty = lines.some((l) => l.product || l.quantity || l.unit_price);
    if (dirty && !window.confirm('Replace the current lines with the items from this requisition?')) return;
    setRequisition(String(value));
    if (String(r.company) !== String(company)) setCompany(String(r.company));
    setLines([{ product: String(r.product), quantity: r.quantity, unit_price: '', tax_code: '' }]);
    setForm((f) => ({ ...f, expected_loading_date: f.expected_loading_date || r.required_date || '' }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!company) { setError('Select the company (legal entity) for this purchase order.'); return; }
    setBusy(true); setError(''); setFieldErr({});
    try {
      const body = {
        ...form,
        company: Number(company),
        lines: lines.filter((l) => l.product && l.quantity && l.unit_price).map((l) => ({
          product: l.product, quantity: l.quantity, unit_price: l.unit_price,
          ...(l.tax_code ? { tax_code: l.tax_code } : {}),
        })),
      };
      if (!body.lines.length) { setError('Add at least one line with product, quantity and unit price.'); setBusy(false); return; }

      if (isEdit) {
        // Clearable optional fields must be sent as null on PUT, otherwise the old value would be kept/invalid.
        ['expected_loading_date', 'loading_depot', 'currency'].forEach((k) => { if (!body[k]) body[k] = null; });
        // Force the server to re-derive the exchange rate from the (possibly changed) currency / order date.
        body.exchange_rate = null;
        body.rate_date = null;
        body.rate_source = '';
        await api.purchaseOrders.update(po.id, body);
        notify('Purchase order updated.', 'success');
        onSaved();
      } else {
        ['expected_loading_date', 'loading_depot', 'currency'].forEach((k) => { if (!body[k]) delete body[k]; });
        if (requisition) body.requisition = Number(requisition);
        const created = await api.purchaseOrders.create(body);
        notify('Purchase order created.', 'success');
        onSaved(created);
      }
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  // Keep the current supplier / depot selectable even if it is no longer in the active list.
  const supplierMissing = isEdit && form.supplier && !suppliers.some((s) => String(s.id) === String(form.supplier));
  const depotMissing = isEdit && form.loading_depot && !depots.some((d) => String(d.id) === String(form.loading_depot));

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true">
            <i className={`bi ${isEdit ? 'bi-pencil-square' : 'bi-bag-plus'}`}></i>
          </span>
          <div className="page-header__text">
            <h1 className="page-title">{isEdit ? `Edit ${po.reference}` : 'New purchase order'}</h1>
            <p className="page-subtitle">
              {isEdit
                ? 'Draft orders can be changed until they are submitted for approval'
                : 'Create a draft, then submit it for approval from the order page'}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {isEdit ? (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              <i className="bi bi-arrow-left"></i>
              Back to order
            </button>
          ) : (
            <Link to="/procurement/purchase-orders" className="btn btn-secondary">
              <i className="bi bi-arrow-left"></i>
              Purchase orders
            </Link>
          )}
        </div>
      </div>

      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <form onSubmit={submit}>
        {/* ---------- requisition picker (create) / linked requisition (edit) */}
        {!isEdit && (
          <section className="page-card">
            <SectionHeader first icon="bi-clipboard-check" title="Requisition" subtitle="Optional" />
            <SectionBody>
              <div className="form-grid">
                <Field label="Approved requisition" err={fieldErr.requisition} span>
                  <>
                    <select className="form-select" value={requisition} onChange={(e) => pickRequisition(e.target.value)}>
                      <option value="">— None (enter the order manually) —</option>
                      {requisitions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.reference} · {r.product_label || r.product} · {Number(r.quantity).toLocaleString()} L
                          {r.required_date ? ` · needed ${r.required_date}` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-muted-soft mt-2 mb-0" style={{ fontSize: '0.8125rem' }}>
                      {requisition
                        ? 'The company, product, quantity and required date were filled from the requisition. You can still change them, and enter the unit price below.'
                        : requisitions.length
                          ? 'Pick an approved requisition to fill in the order automatically.'
                          : 'No approved requisitions are waiting to be converted.'}
                    </p>
                  </>
                </Field>
              </div>
            </SectionBody>
          </section>
        )}

        <section className="page-card">
          <SectionHeader first icon="bi-card-text" title="Order Details" />
          <SectionBody>
            <div className="form-grid">
              {isEdit && po.requisition && (
                <Field label="Requisition">
                  <input className="form-control" value={po.requisition_label || po.requisition} disabled readOnly />
                </Field>
              )}
              <Field label="Company" required err={fieldErr.company}>
                <select className="form-select" value={company} onChange={(e) => changeCompany(e.target.value)} required disabled={isEdit}>
                  <option value="">—</option>
                  {myCompanies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Supplier" required err={fieldErr.supplier}>
                <select className="form-select" value={form.supplier} onChange={set('supplier')} required disabled={!company}>
                  <option value="">—</option>
                  {supplierMissing && <option value={form.supplier}>{po.supplier_label || form.supplier}</option>}
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                </select>
              </Field>
              <Field label="Order date" required err={fieldErr.order_date}>
                <input type="date" className="form-control" value={form.order_date} onChange={set('order_date')} required />
              </Field>
              <Field label="Expected loading" err={fieldErr.expected_loading_date}>
                <input type="date" className="form-control" value={form.expected_loading_date} onChange={set('expected_loading_date')} />
              </Field>
              <Field label="Loading depot" err={fieldErr.loading_depot}>
                <select className="form-select" value={form.loading_depot} onChange={set('loading_depot')} disabled={!company}>
                  <option value="">—</option>
                  {depotMissing && <option value={form.loading_depot}>{po.loading_depot_label || form.loading_depot}</option>}
                  {depots.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
                </select>
              </Field>
              <Field label="Delivery location" err={fieldErr.delivery_location}>
                <input className="form-control" value={form.delivery_location} onChange={set('delivery_location')} />
              </Field>
              <Field label="Payment terms (days)" err={fieldErr.payment_terms_days}>
                <input type="number" min="0" className="form-control num" value={form.payment_terms_days} onChange={set('payment_terms_days')} />
              </Field>
              <Field label="Currency" err={fieldErr.currency}>
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
                    <th className="text-right">Quantity</th>
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
            {busy ? 'Saving...' : isEdit ? 'Save changes' : 'Create PO'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ view */

function EditPO({ id }) {
  const { can } = useAuth();
  const { notify } = useApp();
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [receiving, setReceiving] = useState(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setPo(await api.purchaseOrders.get(id));
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading && !po) {
    return <div><section className="page-card"><TableSkeleton rows={6} columns={6} /></section></div>;
  }
  if (error && !po) {
    return (
      <div>
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (!po) return null;

  // Only drafts are editable (the server enforces the same rule).
  if (editing && po.status === 'DRAFT') {
    return (
      <POForm
        po={po}
        onCancel={() => setEditing(false)}
        onSaved={() => { setEditing(false); load(); }}
      />
    );
  }

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

  const lines = po.lines || [];
  const canEdit = can('procurement.edit');

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-bag-check"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">
              {po.reference}{' '}
              <span className={`status-pill ${poStatusPill(po.status)}`}>{po.status.replace(/_/g, ' ')}</span>
            </h1>
            <p className="page-subtitle">
              {po.supplier_label || po.supplier} · {fmtMoney(po.total, po.currency)}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          <Link to="/procurement/purchase-orders" className="btn btn-secondary">
            <i className="bi bi-arrow-left"></i>
            Purchase orders
          </Link>
          {po.status === 'DRAFT' && canEdit && (
            <button className="btn btn-secondary" onClick={() => setEditing(true)}>
              <i className="bi bi-pencil"></i>
              Edit
            </button>
          )}
          {po.status === 'DRAFT' && canEdit && (
            <button className="btn btn-primary" onClick={submit}>
              <i className="bi bi-send"></i>
              Submit
            </button>
          )}
          {po.status === 'APPROVED' && can('inventory.edit') && (
            <button className="btn btn-primary" onClick={() => setReceiving(lines[0] || null)}>
              <i className="bi bi-box-arrow-in-down"></i>
              Receive goods
            </button>
          )}
          {['DRAFT', 'AWAITING_APPROVAL', 'APPROVED'].includes(po.status) && canEdit && (
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
            ['Company', po.company_label || po.company],
            ['Supplier', po.supplier_label || po.supplier],
            ['Requisition', po.requisition_label || '—'],
            ['Order date', po.order_date],
            ['Expected loading', po.expected_loading_date || '—'],
            ['Loading depot', po.loading_depot_label || '—'],
            ['Currency', po.currency || 'functional'],
            ['Exchange rate', po.exchange_rate || '—'],
            ['Payment terms', `${po.payment_terms_days} days`],
            ['Delivery location', po.delivery_location || '—'],
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
                    <th className="text-right">Received</th>
                    <th className="text-right">Unit price</th>
                    <th className="text-right">Total</th>
                    <th>Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="cell-name">{l.product_label || l.product}</td>
                      <td className="cell-num">{Number(l.quantity).toLocaleString()}</td>
                      <td className="cell-num">{Number(l.received_quantity || 0).toLocaleString()}</td>
                      <td className="cell-num">{Number(l.unit_price).toFixed(6)}</td>
                      <td className="cell-num">{fmtMoney(l.line_total)}</td>
                      <td>{l.tax_code || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={4}>Subtotal</td><td className="cell-num">{fmtMoney(po.subtotal)}</td><td /></tr>
                  <tr><td colSpan={4}>Tax</td><td className="cell-num">{fmtMoney(po.tax_total)}</td><td /></tr>
                  <tr><td colSpan={4}><strong>Total</strong></td><td className="cell-num"><strong>{fmtMoney(po.total)}</strong></td><td /></tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </section>

      {receiving && (
        <ReceiveModal
          po={po}
          line={receiving}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); notify('Goods received.', 'success'); load(); }}
        />
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
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => { api.storageTanks.listAll({ company: po.company }).then(setTanks).catch(() => {}); }, [po.company]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form };
      ['standardized_volume', 'temperature_c', 'density'].forEach((k) => { if (!body[k]) delete body[k]; });
      await api.purchaseOrders.receive(po.id, body);
      onDone();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title="Receive goods"
      subtitle={po.reference}
      icon="bi-box-arrow-in-down"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="receiveForm" disabled={busy}>
            <i className="bi bi-check-lg"></i>
            {busy ? 'Receiving...' : 'Receive'}
          </button>
        </>
      }
    >
      <form id="receiveForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Receipt Details</h6>
        <div className="form-grid">
          <Field label="Line" required err={fieldErr.line} span>
            <select className="form-select" value={form.line} onChange={set('line')} required>
              <option value="">—</option>
              {(po.lines || []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.product_label || l.product} · ordered {Number(l.quantity).toLocaleString()} · received {Number(l.received_quantity || 0).toLocaleString()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tank" required err={fieldErr.tank}>
            <select className="form-select" value={form.tank} onChange={set('tank')} required>
              <option value="">—</option>
              {tanks.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </select>
          </Field>
          <Field label="Receipt date" required>
            <input type="date" className="form-control" value={form.receipt_date} onChange={set('receipt_date')} required />
          </Field>
          <Field label="Delivery note">
            <input className="form-control" value={form.delivery_note} onChange={set('delivery_note')} />
          </Field>
          <Field label="Vehicle reg">
            <input className="form-control font-mono" value={form.vehicle_reg} onChange={set('vehicle_reg')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-thermometer-half" aria-hidden="true"></i>Volume & Measurement</h6>
        <div className="form-grid">
          <Field label="Observed volume (L)" required err={fieldErr.observed_volume}>
            <input type="number" step="0.001" className="form-control num" value={form.observed_volume} onChange={set('observed_volume')} required />
          </Field>
          <Field label="Standardized volume (L)">
            <input type="number" step="0.001" className="form-control num" value={form.standardized_volume} onChange={set('standardized_volume')} />
          </Field>
          <Field label="Temperature (°C)">
            <input type="number" step="0.01" className="form-control num" value={form.temperature_c} onChange={set('temperature_c')} />
          </Field>
          <Field label="Density">
            <input type="number" step="0.0001" className="form-control num" value={form.density} onChange={set('density')} />
          </Field>
        </div>
        <p className="text-muted-soft mt-3" style={{ fontSize: '0.8125rem' }}>
          Stock will move into the tank at the PO unit price × exchange rate. GRNI is credited until the invoice is posted.
        </p>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}