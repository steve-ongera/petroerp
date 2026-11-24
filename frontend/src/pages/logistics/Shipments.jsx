/**
 * Shipments list.
 * - CRUD /shipments/  (make_nested: header + lines atomically)
 * - POST /shipments/:id/submit/           (approval or auto-approve)
 * - Filters: customer, supplier, product, truck_ownership, transporter, vehicle, date range
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage } from '../../services/api';

const STATUSES = [
  '', 'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'AWAITING_LOADING', 'LOADING', 'LOADED',
  'DISPATCHED', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'CLEARED', 'ARRIVED',
  'DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED', 'CANCELLED',
];
const OWNERSHIP = ['', 'OWNED', 'HIRED'];

const fmtMoney = (n, c = '') => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const statusCls = (s) => {
  if (s === 'DRAFT') return 'status status-draft';
  if (['AWAITING_APPROVAL', 'AWAITING_LOADING', 'LOADING', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'RECONCILIATION_PENDING'].includes(s)) return 'status status-pending';
  if (['APPROVED', 'LOADED', 'DISPATCHED', 'CLEARED', 'DELIVERED'].includes(s)) return 'status status-active';
  if (['CLOSED'].includes(s)) return 'status status-closed';
  if (['CANCELLED'].includes(s)) return 'status status-rejected';
  return 'status';
};

export default function Shipments() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ownership, setOwnership] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.shipments.list({
        ...companyParams(), ordering: '-id', page,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        ...(ownership ? { truck_ownership: ownership } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, search, status, ownership]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, ownership]);

  return (
    <div className="app-content">
      <header className="page-header">
        <div className="page-header__main">
          <h1 className="page-header__title">Shipments</h1>
          <p className="page-header__subtitle">
            Loading, transit, delivery and costing{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
          </p>
        </div>
        <div className="page-header__actions">
          {can('shipments.edit') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg" /> New shipment
            </button>
          )}
        </div>
      </header>

      <div className={`table-card ${loading ? 'is-loading' : ''}`}>
        <div className="filters">
          <div className="input-group">
            <span className="input-icon"><i className="bi bi-search" /></span>
            <input className="input" placeholder="Reference, origin, destination…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}
          </select>
          <select className="select" value={ownership} onChange={(e) => setOwnership(e.target.value)}>
            {OWNERSHIP.map((o) => <option key={o} value={o}>{o || 'Any ownership'}</option>)}
          </select>
          <div className="filters__spacer" />
          <span className="text-sm text-muted">{count} shipment{count === 1 ? '' : 's'}</span>
        </div>

        {error ? (
          <div className="card__body"><p className="field-error" role="alert">{error}</p>
            <button className="btn mt-2" onClick={load}>Try again</button></div>
        ) : !rows.length && !loading ? (
          <div className="table-empty"><div className="table-empty__title">No shipments</div>
            <div>Create the first shipment to begin.</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Reference</th><th>Date</th><th>Customer / Supplier</th><th>Product</th>
                <th className="num">Qty</th><th>Origin → Destination</th>
                <th>Ownership</th><th>Status</th><th className="col-actions" />
              </tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">
                      <Link to={`/logistics/shipments/${s.id}`} className="cell-link">{s.reference}</Link>
                    </td>
                    <td>{s.loading_date || '—'}</td>
                    <td>
                      <span className="cell-main">{s.customer_label || s.supplier_label || '—'}</span>
                      <span className="cell-sub">{s.customer ? 'Customer' : s.supplier ? 'Supplier' : ''}</span>
                    </td>
                    <td>{s.product_label || s.product}</td>
                    <td className="num">{Number(s.quantity || 0).toLocaleString()}</td>
                    <td className="text-sm">
                      {s.origin || '—'} <i className="bi bi-arrow-right" /> {s.destination || '—'}
                    </td>
                    <td><span className="badge">{s.truck_ownership || '—'}</span></td>
                    <td><span className={statusCls(s.status)}>{s.status.replace(/_/g, ' ')}</span></td>
                    <td className="col-actions">
                      <Link to={`/logistics/shipments/${s.id}`} className="row-action" title="Open">
                        <i className="bi bi-arrow-right" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} count={count} onChange={setPage} />
      </div>

      {creating && (
        <NewShipmentModal onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); notify('Shipment created.', 'success'); load(); }} />
      )}
    </div>
  );
}

function NewShipmentModal({ onClose, onDone }) {
  const { companyParams } = useApp();
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [transporters, setTransporters] = useState([]);
  const [hiredTrucks, setHiredTrucks] = useState([]);
  const [form, setForm] = useState({
    customer: '', supplier: '', product: '', quantity: '',
    purchase_price: '', selling_price: '', truck_ownership: 'OWNED',
    vehicle: '', driver: '', transporter: '', hired_truck: '',
    origin: '', destination: '', expected_delivery: '',
  });
  const [lines, setLines] = useState([{ product: '', quantity: '', purchase_price: '', selling_price: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.customers.listAll({ ...companyParams() }),
      api.suppliers.listAll({ ...companyParams() }),
      api.products.listAll(),
      api.vehicles.listAll({ ...companyParams() }),
      api.drivers.listAll({ ...companyParams() }),
      api.transporters.listAll({ ...companyParams() }),
      api.transporterVehicles.listAll({ ...companyParams(), kind: 'TRUCK' }),
    ]).then(([c, s, p, v, d, t, h]) => {
      setCustomers(c); setSuppliers(s); setProducts(p); setVehicles(v); setDrivers(d); setTransporters(t); setHiredTrucks(h);
    }).catch(() => {});
  }, [companyParams]);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = {
        ...form,
        company: companyParams().company,
        lines: lines.filter((l) => l.product && l.quantity).map((l) => ({
          product: l.product, quantity: l.quantity,
          ...(l.purchase_price ? { purchase_price: l.purchase_price } : {}),
          ...(l.selling_price ? { selling_price: l.selling_price } : {}),
        })),
      };
      ['customer', 'supplier', 'vehicle', 'driver', 'transporter', 'hired_truck', 'expected_delivery']
        .forEach((k) => { if (!body[k]) delete body[k]; });
      await api.shipments.create(body);
      onDone();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__dialog modal__dialog--xl">
        <div className="modal__header">
          <h2 className="modal__title">New shipment</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal__body">
            <div className="form-grid form-grid--3">
              <Field label="Customer">
                <select className="select" value={form.customer} onChange={set('customer')}>
                  <option value="">—</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </select>
              </Field>
              <Field label="Supplier">
                <select className="select" value={form.supplier} onChange={set('supplier')}>
                  <option value="">—</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                </select>
              </Field>
              <Field label="Ownership">
                <select className="select" value={form.truck_ownership} onChange={set('truck_ownership')}>
                  <option value="OWNED">Owned</option>
                  <option value="HIRED">Hired</option>
                </select>
              </Field>
              <Field label="Origin"><input className="input" value={form.origin} onChange={set('origin')} /></Field>
              <Field label="Destination"><input className="input" value={form.destination} onChange={set('destination')} /></Field>
              <Field label="Expected delivery">
                <input type="datetime-local" className="input" value={form.expected_delivery} onChange={set('expected_delivery')} />
              </Field>
              {form.truck_ownership === 'OWNED' ? (
                <>
                  <Field label="Vehicle">
                    <select className="select" value={form.vehicle} onChange={set('vehicle')}>
                      <option value="">—</option>
                      {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration_number}</option>)}
                    </select>
                  </Field>
                  <Field label="Driver">
                    <select className="select" value={form.driver} onChange={set('driver')}>
                      <option value="">—</option>
                      {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                    </select>
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Transporter">
                    <select className="select" value={form.transporter} onChange={set('transporter')}>
                      <option value="">—</option>
                      {transporters.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Hired truck">
                    <select className="select" value={form.hired_truck} onChange={set('hired_truck')}>
                      <option value="">—</option>
                      {hiredTrucks.map((t) => <option key={t.id} value={t.id}>{t.registration_number}</option>)}
                    </select>
                  </Field>
                </>
              )}
            </div>

            <hr className="divider" />
            <h3 className="h5 mb-2">Lines</h3>
            <div className="line-items">
              <table>
                <thead><tr>
                  <th>Product</th><th className="num">Qty</th><th className="num">Purchase price</th>
                  <th className="num">Selling price</th><th />
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
                      <td><input type="number" step="0.000001" className="input num" value={l.purchase_price} onChange={(e) => setLine(i, 'purchase_price', e.target.value)} /></td>
                      <td><input type="number" step="0.000001" className="input num" value={l.selling_price} onChange={(e) => setLine(i, 'selling_price', e.target.value)} /></td>
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
                        onClick={() => setLines((ls) => [...ls, { product: '', quantity: '', purchase_price: '', selling_price: '' }])}>
                  + Add line
                </button>
              </div>
            </div>

            {error && <p className="field-error mt-3" role="alert">{error}</p>}
          </div>
          <div className="modal__footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div className="field">
      <label className={`label ${required ? 'label--required' : ''}`}>{label}</label>
      {children}
    </div>
  );
}

function Pagination({ page, count, onChange, size = 25 }) {
  const pages = Math.max(1, Math.ceil((count || 0) / size));
  if (count <= size) return null;
  return (
    <div className="pagination pagination--bordered">
      <span className="pagination__info">Page <strong>{page}</strong> of <strong>{pages}</strong> · {count} items</span>
      <div className="pagination__list">
        <button className="pagination__btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <button className="pagination__btn active">{page}</button>
        <button className="pagination__btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}