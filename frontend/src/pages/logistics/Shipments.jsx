/**
 * Shipments list + "New shipment" wizard.
 *
 * Wizard (5 sections): General information -> Route & destination -> Product & quantity ->
 * Fleet & driver -> Trip budget & documents.
 * After saving, the shipment is created (one call with its compartment lines), then the optional trip advance
 * request and the attached documents are saved, and the user lands on the shipment detail page.
 *
 * - CRUD /shipments/  (header + lines atomically)
 * - POST /trip-advances/            (trip budget, optional)
 * - POST /shipment-documents/       (supporting documents, optional)
 * - Server-side pagination (page + count), so it uses a local ServerPagination.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import TableSkeleton from '../../components/TableSkeleton';

const DASH = '\u2014';
const STATUSES = [
  'DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'AWAITING_LOADING', 'LOADING', 'LOADED',
  'DISPATCHED', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'CLEARED', 'ARRIVED',
  'DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED', 'CANCELLED',
];
const TYPES = [
  ['CUSTOMER_DELIVERY', 'Customer delivery'],
  ['DEPOT_TRANSFER', 'Depot transfer'],
  ['EXPORT', 'Export'],
];
const PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'];
const OWNERSHIP = ['OWNED', 'HIRED'];
const DOC_TYPES = [
  ['SALES_ORDER', 'Sales order'],
  ['STOCK_REFERENCE', 'Purchase / stock reference'],
  ['DELIVERY_NOTE', 'Delivery note'],
  ['INVOICE', 'Invoice'],
  ['VEHICLE_COMPLIANCE', 'Vehicle compliance document'],
  ['DRIVER_DOCUMENT', 'Driver document'],
  ['COMMERCIAL_INVOICE', 'Commercial invoice (export)'],
  ['CERTIFICATE_OF_ORIGIN', 'Certificate of origin (export)'],
  ['TRANSIT_DOC', 'Transit document (export)'],
  ['EXPORT_DECLARATION', 'Export declaration'],
  ['OTHER', 'Other supporting document'],
];
const PAGE_SIZE = 25;
// Shipments in these statuses no longer count as "on the way" against a sales order.
const FINISHED = ['DELIVERED', 'RECONCILIATION_PENDING', 'CLOSED', 'CANCELLED'];
// Statuses in which the truck and the driver are busy (same list the server uses at loading / dispatch).
const ACTIVE = ['LOADING', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'CLEARED', 'ARRIVED'];

const STEPS = [
  { key: 'general', label: 'General', icon: 'bi-card-text' },
  { key: 'route', label: 'Route & destination', icon: 'bi-signpost-split' },
  { key: 'product', label: 'Product & quantity', icon: 'bi-droplet-half' },
  { key: 'fleet', label: 'Fleet & driver', icon: 'bi-truck' },
  { key: 'budget', label: 'Trip budget & documents', icon: 'bi-wallet2' },
];

const NO_DATA = {
  orders: [], shipments: [], customers: [], suppliers: [], products: [], currencies: [],
  depots: [], tanks: [], vehicles: [], trailers: [], drivers: [], transporters: [], hiredTrucks: [],
  categories: [], crossings: [],
};
const emptyForm = () => ({
  shipment_type: 'CUSTOMER_DELIVERY', priority: 'NORMAL', remarks: '',
  sales_order: '', customer: '', supplier: '', currency: '',
  product: '', purchase_price: '', selling_price: '',
  depot: '', loading_tank: '', origin: '', destination: '', destination_county: '', delivery_address: '',
  planned_dispatch_date: '', expected_delivery: '', destination_country: '', consignee: '', border_crossing: '',
  truck_ownership: 'OWNED', vehicle: '', trailer: '', driver: '', transporter: '', hired_truck: '',
});
const emptyLine = (tank = '') => ({ compartment: '', tank, quantity: '' });
const emptyAdvance = () => ({ enabled: false, recipient_name: '', recipient_phone: '', payment_method: 'CASH', notes: '', touched: false });
const emptyAdvLine = () => ({
  category: '', description: '', budget_amount: '', requested_amount: '', legal_basis: '', issuing_authority: '', open: false,
});
const emptyDoc = () => ({ doc_type: 'SALES_ORDER', number: '', notes: '', file: null });

const label = (s) => (s || '').replace(/_/g, ' ');
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtLitres = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const fmtMoney = (n, c = '') => {
  const x = Number(n);
  if (n == null || n === '' || Number.isNaN(x)) return DASH;
  return `${c ? `${c} ` : ''}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const statusPill = (s) => {
  if (s === 'DRAFT' || s === 'CLOSED') return 'status-pill--neutral';
  if (['AWAITING_APPROVAL', 'AWAITING_LOADING', 'LOADING', 'IN_TRANSIT', 'AT_BORDER', 'UNDER_CUSTOMS', 'RECONCILIATION_PENDING'].includes(s)) return 'status-pill--warning';
  if (['APPROVED', 'LOADED', 'DISPATCHED', 'CLEARED', 'ARRIVED', 'DELIVERED'].includes(s)) return 'status-pill--success';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral';
};
const priorityPill = (p) => (p === 'URGENT' ? 'status-pill--danger' : p === 'HIGH' ? 'status-pill--warning' : 'status-pill--neutral');

export default function Shipments() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ownership, setOwnership] = useState('');
  const [type, setType] = useState('');
  const [priority, setPriority] = useState('');
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
        ...(type ? { shipment_type: type } : {}),
        ...(priority ? { priority } : {}),
      });
      setRows(res?.results || res || []);
      setCount(res?.count ?? (res?.results || res || []).length);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, page, search, status, ownership, type, priority]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, ownership, type, priority]);

  const hasActiveFilters = !!(search || status || ownership || type || priority);
  const clearFilters = () => { setSearch(''); setStatus(''); setOwnership(''); setType(''); setPriority(''); };
  const typeLabel = (t) => (TYPES.find(([v]) => v === t) || [t, label(t)])[1];

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div className="page-header__lead">

          <div className="page-header__text">
            <h1 className="page-title">Shipments</h1>
            <p className="page-subtitle">
              Orders, dispatch, trip budgets, delivery and costing{activeCompanyObj ? ` \u00b7 ${activeCompanyObj.name}` : ''}
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
              placeholder="Search by reference, customer, origin or destination..."
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
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <select className="form-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Shipment type">
            <option value="">All types</option>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="form-select" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}
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
                Search: &quot;{search}&quot;
                <button onClick={() => setSearch('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {status && (
              <span className="filter-chip">
                Status: {label(status)}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {type && (
              <span className="filter-chip">
                Type: {typeLabel(type)}
                <button onClick={() => setType('')}><i className="bi bi-x"></i></button>
              </span>
            )}
            {priority && (
              <span className="filter-chip">
                Priority: {label(priority)}
                <button onClick={() => setPriority('')}><i className="bi bi-x"></i></button>
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
                    <th>Dispatch</th>
                    <th>Customer / Supplier</th>
                    <th>Product</th>
                    <th className="text-right">Qty (L)</th>
                    <th>Route</th>
                    <th>Type</th>
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
                      <td>{s.planned_dispatch_date || s.loading_date || DASH}</td>
                      <td className="cell-name">
                        {s.customer_label || s.supplier_label || DASH}
                        {(s.customer || s.supplier) && (
                          <div className="text-muted-soft" style={{ fontSize: '0.75rem' }}>
                            {s.customer ? 'Customer' : 'Supplier'}
                          </div>
                        )}
                      </td>
                      <td>{s.product_label || s.product}</td>
                      <td className="cell-num">{Number(s.quantity || 0).toLocaleString()}</td>
                      <td>
                        {s.origin || DASH} <i className="bi bi-arrow-right"></i> {s.destination || DASH}
                        {s.destination_county && (
                          <div className="text-muted-soft" style={{ fontSize: '0.75rem' }}>{s.destination_county}</div>
                        )}
                      </td>
                      <td>
                        <span className="badge badge-neutral">{typeLabel(s.shipment_type)}</span>
                        {s.priority && s.priority !== 'NORMAL' && (
                          <div><span className={`status-pill ${priorityPill(s.priority)}`}>{label(s.priority)}</span></div>
                        )}
                      </td>
                      <td><span className="badge badge-neutral">{s.truck_ownership || DASH}</span></td>
                      <td>
                        <span className={`status-pill ${statusPill(s.status)}`}>{label(s.status)}</span>
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
          onDone={(sh, warnings) => {
            setCreating(false);
            if (warnings.length) notify(`Shipment ${sh.reference} created, but: ${warnings.join(' | ')}`, 'error');
            else notify(`Shipment ${sh.reference} created.`, 'success');
            navigate(`/logistics/shipments/${sh.id}`);
          }}
        />
      )}
    </div>
  );
}

/* ================================================================================================
 * New shipment wizard
 * ============================================================================================== */
function NewShipmentModal({ onClose, onDone }) {
  const { user } = useAuth();
  const { companyParams } = useApp();
  const companies = user?.companies || [];
  const [company, setCompany] = useState(() => String(companyParams().company || (companies.length === 1 ? companies[0].id : '')));
  const [data, setData] = useState(NO_DATA);
  const [loadingData, setLoadingData] = useState(false);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [lines, setLines] = useState([emptyLine()]);
  const [assignLater, setAssignLater] = useState(false);
  const [advance, setAdvance] = useState(emptyAdvance);
  const [advLines, setAdvLines] = useState([emptyAdvLine()]);
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});

  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const setAdv = (k) => (e) => { const v = e.target.value; setAdvance((a) => ({ ...a, [k]: v, touched: k.startsWith('recipient') ? true : a.touched })); };
  const setAdvLine = (i, k, v) => setAdvLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const setDoc = (i, k, v) => setDocs((ds) => ds.map((d, j) => (j === i ? { ...d, [k]: v } : d)));

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
      trailers: api.trailers.listAll(q),
      drivers: api.drivers.listAll(q),
      transporters: api.transporters.listAll(q),
      hiredTrucks: api.transporterVehicles.listAll({ ...q, kind: 'TRUCK' }),
      categories: api.expenseCategories.listAll(),
      crossings: api.borderCrossings.listAll(),
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
    setCompany(e.target.value); setForm(emptyForm()); setLines([emptyLine()]); setAdvance(emptyAdvance());
    setAdvLines([emptyAdvLine()]); setError(''); setFieldErr({}); setStep(0); setReached(0);
  };

  /* ---------- derived values ---------- */
  const companyObj = companies.find((c) => String(c.id) === String(company));
  const ccy = form.currency || companyObj?.currency || '';
  const isExport = form.shipment_type === 'EXPORT';
  const owned = form.truck_ownership === 'OWNED';
  const openOrders = data.orders.filter((o) => ['APPROVED', 'IN_FULFILMENT'].includes(o.status));
  const order = data.orders.find((o) => String(o.id) === String(form.sales_order));
  const orderLine = order?.lines?.find((l) => String(l.product) === String(form.product));
  const onDate = form.planned_dispatch_date || todayISO();

  /** Litres of an order line not yet delivered and not already on another unfinished shipment. */
  const litresLeft = (o, line) => {
    const onTheWay = data.shipments
      .filter((s) => String(s.sales_order) === String(o.id) && String(s.product) === String(line.product) && !FINISHED.includes(s.status))
      .reduce((t, s) => t + Number(s.quantity || 0), 0);
    return Math.max(Number(line.quantity || 0) - Number(line.delivered_quantity || 0) - onTheWay, 0);
  };
  const left = order && orderLine ? litresLeft(order, orderLine) : null;

  const total = Math.round(lines.reduce((t, l) => t + Number(l.quantity || 0), 0) * 1000) / 1000;
  const salesValue = total * Number(form.selling_price || 0);

  const tankChoices = data.tanks.filter((t) =>
    (!form.depot || String(t.depot) === String(form.depot))
    && (!t.product || !form.product || String(t.product) === String(form.product)));

  const busyVehicles = new Set(data.shipments.filter((s) => ACTIVE.includes(s.status) && s.vehicle).map((s) => String(s.vehicle)));
  const busyDrivers = new Set(data.shipments.filter((s) => ACTIVE.includes(s.status) && s.driver).map((s) => String(s.driver)));
  const vehicleProblems = (v) => {
    const out = [];
    if (['MAINTENANCE', 'INACTIVE'].includes(v.status)) out.push(`status ${label(v.status).toLowerCase()}`);
    if (v.insurance_expiry && v.insurance_expiry < onDate) out.push('insurance expired');
    if (v.inspection_expiry && v.inspection_expiry < onDate) out.push('inspection expired');
    if (busyVehicles.has(String(v.id))) out.push('on another active shipment');
    return out;
  };
  const driverProblems = (d) => {
    const out = [];
    if (d.employment_status !== 'ACTIVE') out.push(`status ${label(d.employment_status).toLowerCase()}`);
    if (d.licence_expiry && d.licence_expiry < onDate) out.push('licence expired');
    if (busyDrivers.has(String(d.id))) out.push('on another active shipment');
    return out;
  };

  const vehicle = data.vehicles.find((v) => String(v.id) === String(form.vehicle));
  const driver = data.drivers.find((d) => String(d.id) === String(form.driver));
  const hiredTruck = data.hiredTrucks.find((t) => String(t.id) === String(form.hired_truck));
  const truckChoices = data.hiredTrucks.filter((t) => !form.transporter || String(t.transporter) === String(form.transporter));
  const capacity = Number((owned ? vehicle?.tank_capacity : hiredTruck?.capacity) || 0);
  const overCapacity = capacity > 0 && total > capacity;
  const advTotal = advLines.reduce((t, l) => t + Number(l.requested_amount || 0), 0);
  const advBudget = advLines.reduce((t, l) => t + Number(l.budget_amount || 0), 0);

  /* ---------- handlers that fill dependent fields ---------- */
  const applyOrderLine = (o, line) => {
    const lt = litresLeft(o, line);
    setForm((f) => ({
      ...f,
      sales_order: String(o.id),
      customer: String(o.customer),
      currency: o.currency || '',
      destination: o.delivery_location || f.destination,
      delivery_address: o.delivery_location || f.delivery_address,
      product: String(line.product),
      selling_price: line.unit_price || '',
    }));
    setLines([emptyLine(form.loading_tank && lt ? form.loading_tank : '')].map((l) => ({ ...l, quantity: lt ? String(lt) : '' })));
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
    const d = data.depots.find((x) => String(x.id) === String(id));
    setForm((f) => ({
      ...f, depot: id, loading_tank: '',
      origin: d ? `${d.name}${d.location ? `, ${d.location}` : ''}` : f.origin,
    }));
    setLines((ls) => ls.map((l) => ({ ...l, tank: '' })));
  };
  const pickOriginTank = (id) => {
    setForm((f) => ({ ...f, loading_tank: id }));
    setLines((ls) => ls.map((l) => ({ ...l, tank: id })));
  };
  const pickDriver = (id) => {
    const d = data.drivers.find((x) => String(x.id) === String(id));
    setForm((f) => ({ ...f, driver: id }));
    if (d) {
      setAdvance((a) => (a.touched ? a : { ...a, recipient_name: d.full_name || '', recipient_phone: d.phone || '' }));
    }
  };

  /* ---------- validation ---------- */
  const validate = (n) => {
    if (n >= 0) {
      if (!company) return 'Select the legal entity.';
      if (form.shipment_type === 'CUSTOMER_DELIVERY' && !form.sales_order) return 'Select the approved sales order for this customer delivery.';
    }
    if (n === 1) {
      if (!form.depot) return 'Select the origin depot.';
      if (!form.destination.trim()) return 'Enter the destination.';
      if (!form.planned_dispatch_date) return 'Enter the planned dispatch date.';
      if (form.expected_delivery && form.expected_delivery.slice(0, 10) < form.planned_dispatch_date) {
        return 'Expected delivery cannot be before the planned dispatch date.';
      }
      if (isExport && (!form.destination_country.trim() || !form.consignee.trim())) return 'Export shipments need the destination country and the consignee.';
    }
    if (n === 2) {
      if (!form.product) return 'Select the product.';
      if (lines.some((l) => !(Number(l.quantity) > 0))) return 'Every compartment needs a quantity above zero.';
      if (!(total > 0)) return 'Allocate a quantity above zero.';
      if (left != null && total > left + 0.0005) return `Allocated ${fmtLitres(total)} L is more than the ${fmtLitres(left)} L still to ship on this order.`;
    }
    if (n === 3 && !assignLater) {
      if (owned) {
        if (!form.vehicle || !form.driver) return 'Select the vehicle and the driver, or tick "Assign the fleet later".';
        const vp = vehicle ? vehicleProblems(vehicle) : [];
        if (vp.length) return `Vehicle ${vehicle.registration_number} cannot be assigned: ${vp.join(', ')}.`;
        const dp = driver ? driverProblems(driver) : [];
        if (dp.length) return `Driver ${driver.full_name} cannot be assigned: ${dp.join(', ')}.`;
      } else if (!form.transporter || !form.hired_truck) {
        return 'Select the transporter and the hired truck, or tick "Assign the fleet later".';
      }
      if (overCapacity) return `${fmtLitres(total)} L is more than the truck capacity of ${fmtLitres(capacity)} L.`;
    }
    if (n === 4 && advance.enabled) {
      if (!advance.recipient_name.trim()) return 'Enter the person receiving the trip advance.';
      const used = advLines.filter((l) => l.category || l.requested_amount || l.budget_amount);
      if (!used.length) return 'Add at least one trip budget line, or switch the trip advance off.';
      if (used.some((l) => !l.category || !(Number(l.requested_amount) > 0))) return 'Every budget line needs an expense category and a requested amount above zero.';
    }
    return '';
  };

  const goto = (n) => { setError(''); setFieldErr({}); setStep(n); setReached((r) => Math.max(r, n)); };
  const next = () => {
    for (let i = 0; i <= step; i += 1) {
      const msg = validate(i);
      if (msg) { setError(msg); setStep(i); return; }
    }
    goto(step + 1);
  };

  /* ---------- save ---------- */
  const submit = async () => {
    setError(''); setFieldErr({});
    for (let i = 0; i < STEPS.length; i += 1) {
      const msg = validate(i);
      if (msg) { setError(msg); setStep(i); return; }
    }
    const purchase = form.purchase_price || '0';
    const selling = form.selling_price || '0';
    const body = {
      company: Number(company),
      shipment_type: form.shipment_type,
      priority: form.priority,
      remarks: form.remarks,
      product: form.product,
      quantity: total.toFixed(3),
      purchase_price: purchase,
      selling_price: selling,
      truck_ownership: form.truck_ownership,
      origin: form.origin,
      destination: form.destination,
      destination_county: form.destination_county,
      delivery_address: form.delivery_address,
      destination_country: isExport ? form.destination_country : '',
      consignee: isExport ? form.consignee : '',
      lines: lines.map((l) => ({
        product: form.product,
        quantity: l.quantity,
        compartment: l.compartment,
        purchase_price: purchase,
        selling_price: selling,
        ...(l.tank ? { tank: l.tank } : {}),
      })),
    };
    const firstTank = form.loading_tank || lines.find((l) => l.tank)?.tank;
    if (firstTank) body.loading_tank = firstTank;
    // The loading date drives the exchange rate date, so it follows the planned dispatch date.
    if (form.planned_dispatch_date) { body.planned_dispatch_date = form.planned_dispatch_date; body.loading_date = form.planned_dispatch_date; }
    const optional = ['sales_order', 'customer', 'supplier', 'currency', 'depot', 'border_crossing'];
    optional.forEach((k) => { if (form[k]) body[k] = form[k]; });
    if (!assignLater) {
      (owned ? ['vehicle', 'trailer', 'driver'] : ['transporter', 'hired_truck']).forEach((k) => { if (form[k]) body[k] = form[k]; });
    }
    if (form.expected_delivery) body.expected_delivery = new Date(form.expected_delivery).toISOString();

    setBusy(true);
    let sh;
    try {
      sh = await api.shipments.create(body);
    } catch (err) {
      setError(errorMessage(err)); setFieldErr(fieldErrors(err)); setBusy(false); return;
    }

    // The shipment now exists. Anything that fails below is reported, not lost.
    const warnings = [];
    if (advance.enabled) {
      try {
        await api.tripAdvances.create({
          shipment: sh.id,
          ...(owned && form.driver ? { recipient: form.driver } : {}),
          recipient_name: advance.recipient_name,
          recipient_phone: advance.recipient_phone,
          payment_method: advance.payment_method,
          notes: advance.notes,
          lines: advLines.filter((l) => l.category).map((l) => ({
            category: l.category,
            description: l.description,
            budget_amount: l.budget_amount || 0,
            requested_amount: l.requested_amount || 0,
            legal_basis: l.legal_basis,
            issuing_authority: l.issuing_authority,
          })),
        });
      } catch (err) { warnings.push(`trip advance not saved (${errorMessage(err)})`); }
    }
    for (const d of docs.filter((x) => x.file)) {
      try {
        await api.shipmentDocuments.upload({
          company: Number(company), shipment: sh.id, doc_type: d.doc_type, number: d.number, notes: d.notes, file: d.file,
        });
      } catch (err) { warnings.push(`${d.file.name} not uploaded (${errorMessage(err)})`); }
    }
    setBusy(false);
    onDone(sh, warnings);
  };

  const options = (rows, text) => rows.map((r) => <option key={r.id} value={r.id}>{text(r)}</option>);
  const KVItem = ({ k, children }) => (
    <div className="kv__item"><div className="kv__label">{k}</div><div className="kv__value">{children}</div></div>
  );
  const Check = ({ ok, children }) => (
    <span className={`status-pill ${ok ? 'status-pill--success' : 'status-pill--danger'}`}>{children}</span>
  );

  return (
    <Modal
      show
      onClose={onClose}
      title="New shipment"
      subtitle={`Step ${step + 1} of ${STEPS.length} \u00b7 ${STEPS[step].label}`}
      icon="bi-box-seam"
      size="xl"
      wide
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          {step > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => goto(step - 1)} disabled={busy}>
              <i className="bi bi-arrow-left"></i> Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={next} disabled={loadingData}>
              Next <i className="bi bi-arrow-right"></i>
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || loadingData}>
              <i className="bi bi-save"></i>
              {busy ? 'Creating...' : 'Create shipment'}
            </button>
          )}
        </>
      }
    >
      <style>{`
        .modal-dialog:has(#shipmentForm), .modal__dialog:has(#shipmentForm),
        .modal-box:has(#shipmentForm), .modal-panel:has(#shipmentForm) { width: min(1200px, 95vw); max-width: min(1200px, 95vw); }
        .modal-body:has(#shipmentForm), .modal__body:has(#shipmentForm) { max-height: 75vh; overflow-y: auto; }
      `}</style>

      <form id="shipmentForm" onSubmit={(e) => { e.preventDefault(); if (step < STEPS.length - 1) next(); else submit(); }}>
        {/* ---------- step tabs ---------- */}
        <div className="tabs" style={{ marginBottom: '1rem' }}>
          {STEPS.map((s, i) => (
            <button type="button" key={s.key} className={`tab ${step === i ? 'active' : ''}`} disabled={i > reached}
                    onClick={() => goto(i)}>
              <i className={`bi ${s.icon}`} aria-hidden="true"></i> {i + 1}. {s.label}
            </button>
          ))}
        </div>

        {/* =============== 1. GENERAL INFORMATION =============== */}
        {step === 0 && (
          <>
            <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Shipment Information</h6>
            <div className="form-grid">
              <Field label="Shipment number">
                <input className="form-control" value="Assigned automatically when saved" disabled />
              </Field>
              <Field label="Shipment date">
                <input className="form-control" value={todayISO()} disabled />
              </Field>
              <Field label="Legal entity" required err={fieldErr.company}>
                <select className="form-select" value={company} onChange={changeCompany} required>
                  <option value="">{DASH}</option>
                  {options(companies, (c) => `${c.code} \u00b7 ${c.name}`)}
                </select>
              </Field>
              <Field label="Shipment type" required err={fieldErr.shipment_type}>
                <select className="form-select" value={form.shipment_type} onChange={set('shipment_type')}>
                  {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Priority" err={fieldErr.priority}>
                <select className="form-select" value={form.priority} onChange={set('priority')}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}
                </select>
              </Field>
              <Field
                label="Sales order"
                required={form.shipment_type === 'CUSTOMER_DELIVERY'}
                err={fieldErr.sales_order}
              >
                <select className="form-select" value={form.sales_order} onChange={(e) => pickOrder(e.target.value)} disabled={!company || loadingData}>
                  <option value="">{loadingData ? 'Loading...' : `${DASH} no sales order ${DASH}`}</option>
                  {options(openOrders, (o) => `${o.reference} \u00b7 ${o.customer_label || o.customer}`)}
                </select>
              </Field>
              <Field label="Customer" err={fieldErr.customer}>
                <select className="form-select" value={form.customer} onChange={set('customer')} disabled={!!order}>
                  <option value="">{DASH}</option>
                  {options(data.customers, (c) => `${c.code} \u00b7 ${c.name}`)}
                </select>
              </Field>
              <Field label="Supplier (inbound stock source)" err={fieldErr.supplier}>
                <select className="form-select" value={form.supplier} onChange={set('supplier')}>
                  <option value="">{DASH}</option>
                  {options(data.suppliers, (s) => `${s.code} \u00b7 ${s.name}`)}
                </select>
              </Field>
              <Field label="Remarks" span err={fieldErr.remarks}>
                <textarea className="form-control" rows={2} value={form.remarks} onChange={set('remarks')} />
              </Field>
            </div>
            {order && (
              <div className="alert alert-info mt-3 mb-0" role="status">
                <div>
                  <strong>{order.reference}</strong> &middot; customer and ordered products were filled in from the order.{' '}
                  {(order.lines || []).map((l) =>
                    `${l.product_label || l.product}: ordered ${fmtLitres(l.quantity)} L, still to ship ${fmtLitres(litresLeft(order, l))} L`).join(' | ')}
                </div>
              </div>
            )}
          </>
        )}

        {/* =============== 2. ROUTE & DESTINATION =============== */}
        {step === 1 && (
          <>
            <h6 className="modal-section-title"><i className="bi bi-geo-alt" aria-hidden="true"></i>Dispatch location</h6>
            <div className="form-grid">
              <Field label="Origin depot" required err={fieldErr.depot}>
                <select className="form-select" value={form.depot} onChange={(e) => pickDepot(e.target.value)}>
                  <option value="">{DASH}</option>
                  {options(data.depots, (d) => `${d.code} \u00b7 ${d.name}`)}
                </select>
              </Field>
              <Field label="Origin tank" err={fieldErr.loading_tank}>
                <select className="form-select" value={form.loading_tank} onChange={(e) => pickOriginTank(e.target.value)} disabled={!form.depot}>
                  <option value="">{form.depot ? 'Choose per compartment' : 'Select the depot first'}</option>
                  {options(tankChoices, (t) => `${t.code}${t.product_label ? ` \u00b7 ${t.product_label}` : ''}`)}
                </select>
              </Field>
              <Field label="Dispatch location" span err={fieldErr.origin}>
                <input className="form-control" value={form.origin} onChange={set('origin')} />
              </Field>
            </div>

            <h6 className="modal-section-title"><i className="bi bi-flag" aria-hidden="true"></i>Delivery location</h6>
            <div className="form-grid">
              <Field label="Destination" required err={fieldErr.destination}>
                <input className="form-control" value={form.destination} onChange={set('destination')} />
              </Field>
              <Field label="Destination county" err={fieldErr.destination_county}>
                <input className="form-control" value={form.destination_county} onChange={set('destination_county')} />
              </Field>
              <Field label="Delivery address" span err={fieldErr.delivery_address}>
                <input className="form-control" value={form.delivery_address} onChange={set('delivery_address')} />
              </Field>
              <Field label="Planned dispatch date" required err={fieldErr.planned_dispatch_date}>
                <input type="date" className="form-control" value={form.planned_dispatch_date} onChange={set('planned_dispatch_date')} />
              </Field>
              <Field label="Expected delivery" err={fieldErr.expected_delivery}>
                <input type="datetime-local" className="form-control" value={form.expected_delivery} onChange={set('expected_delivery')} />
              </Field>
            </div>

            {isExport && (
              <>
                <h6 className="modal-section-title"><i className="bi bi-globe2" aria-hidden="true"></i>Export details</h6>
                <div className="form-grid">
                  <Field label="Destination country" required err={fieldErr.destination_country}>
                    <input className="form-control" value={form.destination_country} onChange={set('destination_country')} />
                  </Field>
                  <Field label="Consignee" required err={fieldErr.consignee}>
                    <input className="form-control" value={form.consignee} onChange={set('consignee')} />
                  </Field>
                  <Field label="Border crossing" err={fieldErr.border_crossing}>
                    <select className="form-select" value={form.border_crossing} onChange={set('border_crossing')}>
                      <option value="">{DASH}</option>
                      {options(data.crossings, (b) => b.name)}
                    </select>
                  </Field>
                </div>
                <div className="alert alert-info mt-3 mb-0" role="status">
                  Export shipments need customs and export documentation (export declaration, commercial invoice, certificate of
                  origin, transit document). Attach them in the last step or later on the shipment page.
                </div>
              </>
            )}
          </>
        )}

        {/* =============== 3. PRODUCT & QUANTITY =============== */}
        {step === 2 && (
          <>
            <h6 className="modal-section-title"><i className="bi bi-droplet-half" aria-hidden="true"></i>Fuel / Product Details</h6>
            <div className="form-grid">
              <Field label="Product" required err={fieldErr.product}>
                <select className="form-select" value={form.product} onChange={(e) => pickProduct(e.target.value)} required>
                  <option value="">{DASH}</option>
                  {options(
                    order ? data.products.filter((p) => order.lines?.some((l) => String(l.product) === String(p.id))) : data.products,
                    (p) => `${p.code} \u00b7 ${p.name}`,
                  )}
                </select>
              </Field>
              <Field label="Unit of measurement">
                <input className="form-control" value="Litres" disabled />
              </Field>
              <Field label="Quantity ordered (L)">
                <input className="form-control num" value={orderLine ? fmtLitres(orderLine.quantity) : DASH} disabled />
              </Field>
              <Field label="Still to ship on the order (L)">
                <input className="form-control num" value={left != null ? fmtLitres(left) : DASH} disabled />
              </Field>
              <Field label="Currency" err={fieldErr.currency}>
                <select className="form-select" value={form.currency} onChange={set('currency')} disabled={!!order}>
                  <option value="">Company currency</option>
                  {data.currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </Field>
              <Field label="Unit selling price per litre" err={fieldErr.selling_price}>
                <input type="number" min="0" step="0.000001" className="form-control num" value={form.selling_price} onChange={set('selling_price')} />
              </Field>
              <Field label="Purchase price per litre" err={fieldErr.purchase_price}>
                <input type="number" min="0" step="0.000001" className="form-control num" value={form.purchase_price} onChange={set('purchase_price')} />
              </Field>
              <Field label="Total sales value">
                <input className="form-control num" value={fmtMoney(salesValue, ccy)} disabled />
              </Field>
            </div>

            <h6 className="modal-section-title"><i className="bi bi-columns-gap" aria-hidden="true"></i>Allocation by compartment</h6>
            <div className="table-wrap">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead>
                    <tr>
                      <th>Compartment</th>
                      <th>Source tank</th>
                      <th className="text-right">Quantity allocated (L)</th>
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
                            {options(tankChoices, (t) => `${t.code}${t.product_label ? ` \u00b7 ${t.product_label}` : ''}`)}
                          </select>
                        </td>
                        <td><input type="number" min="0.001" step="0.001" className="form-control num" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} aria-label="Quantity in litres" /></td>
                        <td>
                          {lines.length > 1 && (
                            <button type="button" className="btn btn-icon" title="Remove compartment" aria-label="Remove compartment"
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
                      <td colSpan={2}><strong>Quantity allocated to this shipment</strong></td>
                      <td className="cell-num" colSpan={2}><strong>{fmtLitres(total)} L</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-secondary mt-2" onClick={() => setLines((ls) => [...ls, emptyLine(form.loading_tank)])}>
              <i className="bi bi-plus-lg"></i> Add compartment
            </button>
            <div className="alert alert-info mt-3 mb-0" role="status">
              Allocating fuel to a shipment is not the same as dispatching it. Stock only leaves the tank when the shipment is
              dispatched, and that movement is recorded separately in the inventory.
            </div>
          </>
        )}

        {/* =============== 4. FLEET & DRIVER =============== */}
        {step === 3 && (
          <>
            <h6 className="modal-section-title"><i className="bi bi-truck" aria-hidden="true"></i>Fleet and Driver Records</h6>
            <div className="form-grid">
              <Field label="Truck ownership">
                <select className="form-select" value={form.truck_ownership} onChange={set('truck_ownership')} disabled={assignLater}>
                  <option value="OWNED">Owned fleet</option>
                  <option value="HIRED">Hired (third-party transporter)</option>
                </select>
              </Field>
              <Field label="Fleet assignment" span>
                <label className="form-check">
                  <input type="checkbox" checked={assignLater} onChange={(e) => setAssignLater(e.target.checked)} />{' '}
                  Assign the fleet later (it is required before loading starts)
                </label>
              </Field>
            </div>

            {!assignLater && owned && (
              <>
                <div className="form-grid mt-3">
                  <Field label="Vehicle registration" required err={fieldErr.vehicle}>
                    <select className="form-select" value={form.vehicle} onChange={set('vehicle')}>
                      <option value="">{DASH}</option>
                      {data.vehicles.map((v) => {
                        const p = vehicleProblems(v);
                        return (
                          <option key={v.id} value={v.id} disabled={p.length > 0}>
                            {v.registration_number}{v.truck_type ? ` \u00b7 ${v.truck_type}` : ''}{p.length ? ` (${p.join(', ')})` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </Field>
                  <Field label="Trailer" err={fieldErr.trailer}>
                    <select className="form-select" value={form.trailer} onChange={set('trailer')}>
                      <option value="">{DASH}</option>
                      {options(data.trailers, (t) => t.registration_number)}
                    </select>
                  </Field>
                  <Field label="Driver" required err={fieldErr.driver}>
                    <select className="form-select" value={form.driver} onChange={(e) => pickDriver(e.target.value)}>
                      <option value="">{DASH}</option>
                      {data.drivers.map((d) => {
                        const p = driverProblems(d);
                        return (
                          <option key={d.id} value={d.id} disabled={p.length > 0}>
                            {d.full_name}{p.length ? ` (${p.join(', ')})` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </Field>
                </div>

                {(vehicle || driver) && (
                  <div className="kv mt-3">
                    {vehicle && (
                      <>
                        <KVItem k="Vehicle type">{vehicle.truck_type || DASH}</KVItem>
                        <KVItem k="Tank capacity">{fmtLitres(vehicle.tank_capacity)} L</KVItem>
                        <KVItem k="Vehicle compliance">
                          <Check ok={vehicleProblems(vehicle).length === 0}>
                            {vehicleProblems(vehicle).length === 0 ? 'Verified' : 'Not compliant'}
                          </Check>
                          <div className="text-muted-soft" style={{ fontSize: '0.75rem' }}>
                            Insurance {vehicle.insurance_expiry || 'no date'} &middot; Inspection {vehicle.inspection_expiry || 'no date'}
                          </div>
                        </KVItem>
                      </>
                    )}
                    {driver && (
                      <>
                        <KVItem k="Driver contact">{driver.phone || DASH}</KVItem>
                        <KVItem k="Driver certification">
                          <Check ok={driverProblems(driver).length === 0}>
                            {driverProblems(driver).length === 0 ? 'Verified' : 'Not compliant'}
                          </Check>
                          <div className="text-muted-soft" style={{ fontSize: '0.75rem' }}>
                            Licence {driver.licence_number || DASH}{driver.licence_expiry ? ` \u00b7 expires ${driver.licence_expiry}` : ''}
                          </div>
                        </KVItem>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {!assignLater && !owned && (
              <>
                <div className="form-grid mt-3">
                  <Field label="Transporter" required err={fieldErr.transporter}>
                    <select className="form-select" value={form.transporter}
                            onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, transporter: v, hired_truck: '' })); }}>
                      <option value="">{DASH}</option>
                      {options(data.transporters, (t) => `${t.code} \u00b7 ${t.name}`)}
                    </select>
                  </Field>
                  <Field label="Hired truck" required err={fieldErr.hired_truck}>
                    <select className="form-select" value={form.hired_truck} onChange={set('hired_truck')} disabled={!form.transporter}>
                      <option value="">{form.transporter ? DASH : 'Select the transporter first'}</option>
                      {options(truckChoices, (t) => t.registration_number)}
                    </select>
                  </Field>
                </div>
                {hiredTruck && (
                  <div className="kv mt-3">
                    <KVItem k="Truck capacity">{fmtLitres(hiredTruck.capacity)} L</KVItem>
                    <KVItem k="Driver">{hiredTruck.driver_name || DASH}</KVItem>
                    <KVItem k="Driver contact">{hiredTruck.driver_phone || DASH}</KVItem>
                  </div>
                )}
                <div className="alert alert-info mt-3 mb-0" role="status">
                  A hired truck also needs an approved transport booking before loading can start.
                </div>
              </>
            )}

            {capacity > 0 && !assignLater && (
              <div className={`alert ${overCapacity ? 'alert-danger' : 'alert-info'} mt-3 mb-0`} role="status">
                {fmtLitres(total)} L allocated &middot; truck capacity {fmtLitres(capacity)} L
                {overCapacity ? ' \u2014 the allocation is more than the truck can carry.' : '.'}
              </div>
            )}
          </>
        )}

        {/* =============== 5. TRIP BUDGET & DOCUMENTS =============== */}
        {step === 4 && (
          <>
            <h6 className="modal-section-title"><i className="bi bi-wallet2" aria-hidden="true"></i>Trip Advance Request</h6>
            <label className="form-check">
              <input type="checkbox" checked={advance.enabled} onChange={(e) => setAdvance((a) => ({ ...a, enabled: e.target.checked }))} />{' '}
              Request a trip advance for this shipment (sent for approval from the shipment page)
            </label>

            {advance.enabled && (
              <>
                <div className="form-grid mt-3">
                  <Field label="Person receiving the advance" required>
                    <input className="form-control" value={advance.recipient_name} onChange={setAdv('recipient_name')} />
                  </Field>
                  <Field label="Phone">
                    <input className="form-control" value={advance.recipient_phone} onChange={setAdv('recipient_phone')} />
                  </Field>
                  <Field label="Payment method">
                    <select className="form-select" value={advance.payment_method} onChange={setAdv('payment_method')}>
                      <option value="CASH">Cash</option>
                      <option value="MPESA">M-Pesa</option>
                      <option value="BANK">Bank transfer</option>
                    </select>
                  </Field>
                  <Field label="Notes">
                    <input className="form-control" value={advance.notes} onChange={setAdv('notes')} />
                  </Field>
                </div>

                <div className="table-wrap mt-3">
                  <div className="table-responsive">
                    <table className="table mb-0">
                      <thead>
                        <tr>
                          <th>Expense category</th>
                          <th>Description</th>
                          <th className="text-right">Budget</th>
                          <th className="text-right">Requested</th>
                          <th style={{ width: '5rem' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {advLines.map((l, i) => (
                          <FragmentRows key={i}>
                            <tr>
                              <td>
                                <select className="form-select" value={l.category} onChange={(e) => setAdvLine(i, 'category', e.target.value)} aria-label="Expense category">
                                  <option value="">{DASH}</option>
                                  {options(data.categories, (c) => c.name)}
                                </select>
                              </td>
                              <td><input className="form-control" value={l.description} onChange={(e) => setAdvLine(i, 'description', e.target.value)} aria-label="Description" /></td>
                              <td><input type="number" min="0" step="0.01" className="form-control num" value={l.budget_amount} onChange={(e) => setAdvLine(i, 'budget_amount', e.target.value)} aria-label="Budget" /></td>
                              <td><input type="number" min="0" step="0.01" className="form-control num" value={l.requested_amount} onChange={(e) => setAdvLine(i, 'requested_amount', e.target.value)} aria-label="Requested" /></td>
                              <td>
                                <button type="button" className="btn btn-icon" title="Statutory charge details" aria-label="Statutory charge details"
                                        onClick={() => setAdvLine(i, 'open', !l.open)}>
                                  <i className={`bi ${l.open ? 'bi-chevron-up' : 'bi-chevron-down'}`}></i>
                                </button>
                                {advLines.length > 1 && (
                                  <button type="button" className="btn btn-icon" title="Remove line" aria-label="Remove line"
                                          onClick={() => setAdvLines((ls) => ls.filter((_, j) => j !== i))}>
                                    <i className="bi bi-x-lg"></i>
                                  </button>
                                )}
                              </td>
                            </tr>
                            {l.open && (
                              <tr>
                                <td colSpan={5}>
                                  <div className="form-grid">
                                    <Field label="Legal basis (statutory or county charges)">
                                      <input className="form-control" value={l.legal_basis} onChange={(e) => setAdvLine(i, 'legal_basis', e.target.value)} />
                                    </Field>
                                    <Field label="Issuing authority">
                                      <input className="form-control" value={l.issuing_authority} onChange={(e) => setAdvLine(i, 'issuing_authority', e.target.value)} />
                                    </Field>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </FragmentRows>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2}><strong>Total</strong></td>
                          <td className="cell-num"><strong>{fmtMoney(advBudget)}</strong></td>
                          <td className="cell-num"><strong>{fmtMoney(advTotal)}</strong></td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-secondary mt-2" onClick={() => setAdvLines((ls) => [...ls, emptyAdvLine()])}>
                  <i className="bi bi-plus-lg"></i> Add budget line
                </button>
                <p className="text-muted-soft mt-2 mb-0" style={{ fontSize: '0.8125rem' }}>
                  Record only legitimate, applicable charges. For county levies and route charges, open the line details and enter the
                  legal basis and the issuing authority, then keep the receipt for the reconciliation.
                </p>
              </>
            )}

            <h6 className="modal-section-title">
              <i className="bi bi-paperclip" aria-hidden="true"></i>Shipment Documentation
            </h6>
            {docs.length === 0 && <p className="text-muted-soft mb-2">No documents attached yet. You can also add them later from the shipment page.</p>}
            {docs.map((d, i) => (
              <div className="form-grid mb-2" key={i}>
                <Field label="Document type">
                  <select className="form-select" value={d.doc_type} onChange={(e) => setDoc(i, 'doc_type', e.target.value)}>
                    {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Reference number">
                  <input className="form-control" value={d.number} onChange={(e) => setDoc(i, 'number', e.target.value)} />
                </Field>
                <Field label="File">
                  <input type="file" className="form-control" onChange={(e) => setDoc(i, 'file', e.target.files?.[0] || null)} />
                </Field>
                <Field label=" ">
                  <button type="button" className="btn btn-outline-danger" onClick={() => setDocs((ds) => ds.filter((_, j) => j !== i))}>
                    <i className="bi bi-trash"></i> Remove
                  </button>
                </Field>
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDocs((ds) => [...ds, emptyDoc()])}>
              <i className="bi bi-plus-lg"></i> Attach document
            </button>

            <h6 className="modal-section-title"><i className="bi bi-clipboard-check" aria-hidden="true"></i>Summary</h6>
            <div className="kv">
              <KVItem k="Type / priority">{label(form.shipment_type)} &middot; {label(form.priority)}</KVItem>
              <KVItem k="Customer">{data.customers.find((c) => String(c.id) === String(form.customer))?.name || DASH}</KVItem>
              <KVItem k="Route">{form.origin || DASH} {'\u2192'} {form.destination || DASH}</KVItem>
              <KVItem k="Product">{data.products.find((p) => String(p.id) === String(form.product))?.name || DASH}</KVItem>
              <KVItem k="Quantity">{fmtLitres(total)} L</KVItem>
              <KVItem k="Sales value">{fmtMoney(salesValue, ccy)}</KVItem>
              <KVItem k="Vehicle / driver">
                {assignLater ? 'To be assigned' : owned ? `${vehicle?.registration_number || DASH} \u00b7 ${driver?.full_name || DASH}` : `${hiredTruck?.registration_number || DASH} (hired)`}
              </KVItem>
              <KVItem k="Trip advance requested">{advance.enabled ? fmtMoney(advTotal) : 'None'}</KVItem>
            </div>
          </>
        )}

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

/** A fragment that accepts a key, so one budget line can render two table rows. */
function FragmentRows({ children }) { return <>{children}</>; }

function ServerPagination({ page, count, onChange, size = PAGE_SIZE }) {
  const pages = Math.max(1, Math.ceil((count || 0) / size));
  if (count <= size) return null;
  return (
    <div className="pagination pagination--bordered">
      <span className="pagination__info">Page <strong>{page}</strong> of <strong>{pages}</strong> &middot; {count} items</span>
      <div className="pagination__list">
        <button className="pagination__btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <button className="pagination__btn active">{page}</button>
        <button className="pagination__btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}