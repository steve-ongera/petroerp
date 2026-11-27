/**
 * Shipments list.
 * - CRUD /shipments/  (make_nested: header + lines atomically)
 * - POST /shipments/:id/submit/           (approval or auto-approve)
 * - Filters: customer, supplier, product, truck_ownership, transporter, vehicle, date range
 *
 * Pagination is server-side here (page + count) because the shipment list can grow large,
 * so it uses a local ServerPagination instead of usePagination (which slices client-side).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import TableSkeleton from '../../components/TableSkeleton';

const STATUSES = [
  'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'AWAITING_LOADING', 'LOADING', 'LOADED',
  'DISPATCHED', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'CLEARED', 'ARRIVED',
  'DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED', 'CANCELLED',
];
const OWNERSHIP = ['OWNED', 'HIRED'];
const PAGE_SIZE = 25;
// Shipments in these statuses no longer count as "on the way" against a sales order.
const FINISHED = ['DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED', 'CANCELLED'];

const NO_DATA = {
  orders: [], shipments: [], customers: [], suppliers: [], products: [], currencies: [],
  depots: [], tanks: [], vehicles: [], drivers: [], transporters: [], hiredTrucks: [],
};
const emptyForm = () => ({
  sales_order: '', customer: '', supplier: '', product: '', currency: '',
  purchase_price: '', selling_price: '', truck_ownership: 'OWNED',
  vehicle: '', driver: '', transporter: '', hired_truck: '', depot: '',
  origin: '', destination: '', loading_date: '', expected_delivery: '',
});
const emptyLine = () => ({ compartment: '', tank: '', quantity: '' });
const fmtLitres = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

const statusPill = (s) => {
  if (s === 'DRAFT' || s === 'CLOSED') return 'status-pill--neutral';
  if (['AWAITING_APPROVAL', 'AWAITING_LOADING', 'LOADING', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'RECONCILIATION_PENDING'].includes(s)) return 'status-pill--warning';
  if (['APPROVED', 'LOADED', 'DISPATCHED', 'CLEARED', 'ARRIVED', 'DELIVERED'].includes(s)) return 'status-pill--success';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral';
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
      setCount(res?.count ?? (res?.results || res || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, search, status, ownership]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, ownership]);

  const hasActiveFilters = !!(search || status || ownership);
  const clearFilters = () => { setSearch(''); setStatus(''); setOwnership(''); };

  return (
    <div>
      {/* ---------- Page header: icon tile + title + actions ---------- */}
      <div className="page-header">
        <div className="page-header__lead">
          
          <div className="page-header__text">
            <h1 className="page-title">Shipments</h1>
            <p className="page-subtitle">
              Loading, transit, delivery and costing{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('shipments.edit') && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <i className="bi bi-plus-lg"></i>
              New shipment
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={load}>Try again</button>
        </div>
      )}

      {/* ---------- One white card: search, filters, table, pagination ---------- */}
      <section className="page-card">
        <div className="search-bar">
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by reference, origin or destination..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search shipments"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <select className="form-select" value={ownership} onChange={(e) => setOwnership(e.target.value)} aria-label="Ownership">
            <option value="">Any ownership</option>
            {OWNERSHIP.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {hasActiveFilters && (
            <button className="btn btn-secondary" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="chip-row">
            {search && (
              <span className="filter-chip">
                Search: "{search}"
                <button onClick={() => setSearch('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {status && (
              <span className="filter-chip">
                Status: {status.replace(/_/g, ' ')}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {ownership && (
              <span className="filter-chip">
                Ownership: {ownership}
                <button onClick={() => setOwnership('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Shipment List
          </span>
          <span className="chart-card__subtitle">
            {count} shipment{count !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-box-seam"></i>
            <h6>{hasActiveFilters ? 'No shipments match your search' : 'No shipments yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New shipment' to add the first one"}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th>Customer / Supplier</th>
                    <th>Product</th>
                    <th className="text-right">Qty (L)</th>
                    <th>Origin ? Destination</th>
                    <th>Ownership</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '6rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-mono fw-600">
                        <Link to={`/logistics/shipments/${s.id}`} className="text-brand">{s.reference}</Link>
                      </td>
                      <td>{s.loading_date || '—'}</td>
                      <td className="cell-name">
                        {s.customer_label || s.supplier_label || '—'}
                        {(s.customer || s.supplier) && (
                          <div className="text-muted-soft" style={{ fontSize: '0.75rem' }}>
                            {s.customer ? 'Customer' : 'Supplier'}
                          </div>
                        )}
                      </td>
                      <td>{s.product_label || s.product}</td>
                      <td className="cell-num">{Number(s.quantity || 0).toLocaleString()}</td>
                      <td>
                        {s.origin || '—'} <i className="bi bi-arrow-right"></i> {s.destination || '—'}
                      </td>
                      <td><span className="badge badge-neutral">{s.truck_ownership || '—'}</span></td>
                      <td>
                        <span className={`status-pill ${statusPill(s.status)}`}>{s.status.replace(/_/g, ' ')}</span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <Link to={`/logistics/shipments/${s.id}`} className="btn btn-icon" title="Open" aria-label="Open">
                            <i className="bi bi-arrow-right"></i>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <ServerPagination page={page} count={count} onChange={setPage} />}
      </section>

      {creating && (
        <NewShipmentModal
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); notify('Shipment created.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

/**
 * New shipment. The server needs company, product, quantity and prices on the shipment HEADER as well as lines.
 * One shipment carries one product; extra lines are truck compartments / source tanks. Header quantity = sum of lines.
 */
function NewShipmentModal({ onClose, onDone }) {
  const { user } = useAuth();
  const { companyParams } = useApp();
  const companies = user?.companies || [];
  const [company, setCompany] = useState(() => String(companyParams().company || (companies.length === 1 ? companies[0].id : '')));
  const [data, setData] = useState(NO_DATA);
  const [loadingData, setLoadingData] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [lines, setLines] = useState([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  // Everything in the dropdowns belongs to the chosen legal entity.
  useEffect(() => {
    setData(NO_DATA);
    if (!company) return undefined;
    let alive = true;
    setLoadingData(true); setError('');
    const q = { company };
    const sources = {
      orders: api.salesOrders.listAll(q),
      shipments: api.shipments.listAll(q),
      customers: api.customers.listAll(q),
      suppliers: api.suppliers.listAll(q),
      products: api.products.listAll(),
      currencies: api.currencies.listAll(),
      depots: api.depots.listAll(q),
      tanks: api.storageTanks.listAll(q),
      vehicles: api.vehicles.listAll(q),
      drivers: api.drivers.listAll(q),
      transporters: api.transporters.listAll(q),
      hiredTrucks: api.transporterVehicles.listAll({ ...q, kind: 'TRUCK' }),
    };
    const keys = Object.keys(sources);
    Promise.allSettled(Object.values(sources)).then((results) => {
      if (!alive) return;
      const next = { ...NO_DATA };
      const failed = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[keys[i]] = r.value;
        else failed.push(`${keys[i]}: ${errorMessage(r.reason)}`);
      });
      setData(next);
      if (failed.length) setError(`Some lists did not load. ${failed.join(' | ')}`);
      setLoadingData(false);
    });
    return () => { alive = false; };
  }, [company]);

  const changeCompany = (e) => {
    setCompany(e.target.value); setForm(emptyForm()); setLines([emptyLine()]); setError(''); setFieldErr({});
  };

  const openOrders = data.orders.filter((o) => ['APPROVED', 'IN_FULFILMENT'].includes(o.status));
  const order = data.orders.find((o) => String(o.id) === String(form.sales_order));

  /** Litres of an order line not yet delivered and not already on another unfinished shipment. */
  const litresLeft = (o, line) => {
    const onTheWay = data.shipments
      .filter((s) => String(s.sales_order) === String(o.id) && String(s.product) === String(line.product)
        && !FINISHED.includes(s.status))
      .reduce((t, s) => t + Number(s.quantity || 0), 0);
    return Math.max(Number(line.quantity || 0) - Number(line.delivered_quantity || 0) - onTheWay, 0);
  };

  const applyOrderLine = (o, line) => {
    const left = litresLeft(o, line);
    setForm((f) => ({
      ...f,
      sales_order: String(o.id),
      customer: String(o.customer),
      currency: o.currency || '',
      destination: o.delivery_location || f.destination,
      product: String(line.product),
      selling_price: line.unit_price || '',
    }));
    setLines([{ ...emptyLine(), quantity: left ? String(left) : '' }]);
  };

  const pickOrder = (id) => {
    const o = data.orders.find((x) => String(x.id) === String(id));
    if (!o) { setForm((f) => ({ ...f, sales_order: '' })); return; }
    const line = (o.lines || []).find((l) => litresLeft(o, l) > 0) || o.lines?.[0];
    if (line) applyOrderLine(o, line);
    else setForm((f) => ({ ...f, sales_order: String(o.id), customer: String(o.customer) }));
  };

  const pickProduct = (id) => {
    const line = order?.lines?.find((l) => String(l.product) === String(id));
    if (line) { applyOrderLine(order, line); return; }
    setForm((f) => ({ ...f, product: id }));
    setLines((ls) => ls.map((l) => ({ ...l, tank: '' })));
  };

  const pickDepot = (id) => {
    setForm((f) => ({ ...f, depot: id }));
    setLines((ls) => ls.map((l) => ({ ...l, tank: '' })));
  };

  const tankChoices = data.tanks.filter((t) =>
    (!form.depot || String(t.depot) === String(form.depot))
    && (!t.product || !form.product || String(t.product) === String(form.product)));
  const truckChoices = data.hiredTrucks.filter((t) => !form.transporter || String(t.transporter) === String(form.transporter));
  const owned = form.truck_ownership === 'OWNED';
  const truck = owned
    ? data.vehicles.find((v) => String(v.id) === String(form.vehicle))
    : data.hiredTrucks.find((t) => String(t.id) === String(form.hired_truck));
  const capacity = Number((owned ? truck?.tank_capacity : truck?.capacity) || 0);
  const total = Math.round(lines.reduce((t, l) => t + Number(l.quantity || 0), 0) * 1000) / 1000;
  const overCapacity = capacity > 0 && total > capacity;

  const submit = async (e) => {
    e.preventDefault(); setError(''); setFieldErr({});
    if (!company) { setError('Select the legal entity.'); return; }
    if (!form.product) { setError('Select the product.'); return; }
    if (lines.some((l) => !(Number(l.quantity) > 0))) { setError('Every line needs a quantity above zero.'); return; }
    if (overCapacity) { setError(`${fmtLitres(total)} L is more than the truck capacity of ${fmtLitres(capacity)} L.`); return; }

    // Blank prices are sent as 0: the server rejects an empty string for a number.
    const purchase = form.purchase_price || '0';
    const selling = form.selling_price || '0';
    const body = {
      company: Number(company),
      product: form.product,
      quantity: total.toFixed(3),
      purchase_price: purchase,
      selling_price: selling,
      truck_ownership: form.truck_ownership,
      origin: form.origin,
      destination: form.destination,
      lines: lines.map((l) => ({
        product: form.product,
        quantity: l.quantity,
        compartment: l.compartment,
        purchase_price: purchase,
        selling_price: selling,
        ...(l.tank ? { tank: l.tank } : {}),
      })),
    };
    // Optional fields are left out when blank.
    const optional = ['sales_order', 'customer', 'supplier', 'currency', 'depot', 'loading_date',
      ...(owned ? ['vehicle', 'driver'] : ['transporter', 'hired_truck'])];
    optional.forEach((k) => { if (form[k]) body[k] = form[k]; });
    if (form.expected_delivery) body.expected_delivery = new Date(form.expected_delivery).toISOString();

    setBusy(true);
    try {
      await api.shipments.create(body);
      onDone();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  const options = (rows, label) => rows.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>);

  return (
    <Modal
      show
      onClose={onClose}
      title="New shipment"
      subtitle="Loading, transit, delivery and costing"
      icon="bi-box-seam"
      size="xl"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="shipmentForm" disabled={busy || loadingData}>
            <i className="bi bi-save"></i>
            {busy ? 'Creating...' : 'Create'}
          </button>
        </>
      }
    >
      <form id="shipmentForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-bag-check" aria-hidden="true"></i>Order</h6>
        <div className="form-grid">
          <Field label="Legal entity" required err={fieldErr.company}>
            <select className="form-select" value={company} onChange={changeCompany} required>
              <option value="">—</option>
              {options(companies, (c) => `${c.code} · ${c.name}`)}
            </select>
          </Field>
          <Field label="Sales order" err={fieldErr.sales_order}>
            <select className="form-select" value={form.sales_order} onChange={(e) => pickOrder(e.target.value)} disabled={!company || loadingData}>
              <option value="">{loadingData ? 'Loading...' : '— no sales order —'}</option>
              {options(openOrders, (o) => `${o.reference} · ${o.customer_label || o.customer}`)}
            </select>
          </Field>
        </div>
        {order && (
          <div className="alert alert-info mt-3 mb-0" role="status">
            <div>
              <strong>{order.reference}</strong>: {(order.lines || []).map((l) =>
                `${l.product_label || l.product}, ordered ${fmtLitres(l.quantity)} L, still to ship ${fmtLitres(litresLeft(order, l))} L`).join(' | ')}
            </div>
          </div>
        )}

        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Shipment Details</h6>
        <div className="form-grid">
          <Field label="Customer" err={fieldErr.customer}>
            <select className="form-select" value={form.customer} onChange={set('customer')} disabled={!!order}>
              <option value="">—</option>
              {options(data.customers, (c) => `${c.code} · ${c.name}`)}
            </select>
          </Field>
          <Field label="Supplier" err={fieldErr.supplier}>
            <select className="form-select" value={form.supplier} onChange={set('supplier')}>
              <option value="">—</option>
              {options(data.suppliers, (s) => `${s.code} · ${s.name}`)}
            </select>
          </Field>
          <Field label="Product" required err={fieldErr.product}>
            <select className="form-select" value={form.product} onChange={(e) => pickProduct(e.target.value)} required>
              <option value="">—</option>
              {options(
                order ? data.products.filter((p) => order.lines?.some((l) => String(l.product) === String(p.id))) : data.products,
                (p) => `${p.code} · ${p.name}`,
              )}
            </select>
          </Field>
          <Field label="Currency" err={fieldErr.currency}>
            <select className="form-select" value={form.currency} onChange={set('currency')} disabled={!!order}>
              <option value="">Company currency</option>
              {data.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </Field>
          <Field label="Purchase price per litre" err={fieldErr.purchase_price}>
            <input type="number" min="0" step="0.000001" className="form-control num" value={form.purchase_price} onChange={set('purchase_price')} />
          </Field>
          <Field label="Selling price per litre" err={fieldErr.selling_price}>
            <input type="number" min="0" step="0.000001" className="form-control num" value={form.selling_price} onChange={set('selling_price')} />
          </Field>
          <Field label="Origin" err={fieldErr.origin}><input className="form-control" value={form.origin} onChange={set('origin')} /></Field>
          <Field label="Destination" err={fieldErr.destination}><input className="form-control" value={form.destination} onChange={set('destination')} /></Field>
          <Field label="Loading date" err={fieldErr.loading_date}>
            <input type="date" className="form-control" value={form.loading_date} onChange={set('loading_date')} />
          </Field>
          <Field label="Expected delivery" err={fieldErr.expected_delivery}>
            <input type="datetime-local" className="form-control" value={form.expected_delivery} onChange={set('expected_delivery')} />
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-truck" aria-hidden="true"></i>Transport</h6>
        <div className="form-grid">
          <Field label="Ownership">
            <select className="form-select" value={form.truck_ownership} onChange={set('truck_ownership')}>
              <option value="OWNED">Owned</option>
              <option value="HIRED">Hired</option>
            </select>
          </Field>
          {owned ? (
            <>
              <Field label="Vehicle" err={fieldErr.vehicle}>
                <select className="form-select" value={form.vehicle} onChange={set('vehicle')}>
                  <option value="">—</option>
                  {options(data.vehicles, (v) => `${v.registration_number} · ${v.status.replace(/_/g, ' ')}`)}
                </select>
              </Field>
              <Field label="Driver" err={fieldErr.driver}>
                <select className="form-select" value={form.driver} onChange={set('driver')}>
                  <option value="">—</option>
                  {options(data.drivers, (d) => d.full_name)}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Transporter" err={fieldErr.transporter}>
                <select
                  className="form-select" value={form.transporter}
                  onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, transporter: v, hired_truck: '' })); }}
                >
                  <option value="">—</option>
                  {options(data.transporters, (t) => `${t.code} · ${t.name}`)}
                </select>
              </Field>
              <Field label="Hired truck" err={fieldErr.hired_truck}>
                <select className="form-select" value={form.hired_truck} onChange={set('hired_truck')} disabled={!form.transporter}>
                  <option value="">—</option>
                  {options(truckChoices, (t) => t.registration_number)}
                </select>
              </Field>
            </>
          )}
          <Field label="Loading depot" err={fieldErr.depot}>
            <select className="form-select" value={form.depot} onChange={(e) => pickDepot(e.target.value)}>
              <option value="">—</option>
              {options(data.depots, (d) => `${d.code} · ${d.name}`)}
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-droplet-half" aria-hidden="true"></i>Compartments</h6>
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Compartment</th>
                  <th>Source tank</th>
                  <th className="text-right">Qty (L)</th>
                  <th style={{ width: '3rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td><input className="form-control" maxLength={20} placeholder="Optional" value={l.compartment} onChange={(e) => setLine(i, 'compartment', e.target.value)} aria-label="Compartment" /></td>
                    <td>
                      <select className="form-select" value={l.tank} onChange={(e) => setLine(i, 'tank', e.target.value)} aria-label="Source tank">
                        <option value="">Choose at loading</option>
                        {options(tankChoices, (t) => `${t.code}${t.product_label ? ` · ${t.product_label}` : ''}`)}
                      </select>
                    </td>
                    <td><input type="number" min="0.001" step="0.001" className="form-control num" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} required aria-label="Quantity in litres" /></td>
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
              <tfoot>
                <tr>
                  <td colSpan={2}><strong>Shipment quantity</strong></td>
                  <td className="cell-num" colSpan={2}><strong>{fmtLitres(total)} L</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-secondary mt-2" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
          <i className="bi bi-plus-lg"></i> Add compartment
        </button>
        {overCapacity && (
          <div className="alert alert-danger mt-3" role="alert">
            Quantity is more than the truck capacity of {fmtLitres(capacity)} L.
          </div>
        )}

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function ServerPagination({ page, count, onChange, size = PAGE_SIZE }) {
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