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
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-box-seam"></i></span>
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
                    <th>Origin → Destination</th>
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
  const [fieldErr, setFieldErr] = useState({});
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
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
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
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

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
          <button className="btn btn-primary" type="submit" form="shipmentForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Creating...' : 'Create'}
          </button>
        </>
      }
    >
      <form id="shipmentForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-card-text" aria-hidden="true"></i>Shipment Details</h6>
        <div className="form-grid">
          <Field label="Customer" err={fieldErr.customer}>
            <select className="form-select" value={form.customer} onChange={set('customer')}>
              <option value="">—</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </Field>
          <Field label="Supplier" err={fieldErr.supplier}>
            <select className="form-select" value={form.supplier} onChange={set('supplier')}>
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </Field>
          <Field label="Origin"><input className="form-control" value={form.origin} onChange={set('origin')} /></Field>
          <Field label="Destination"><input className="form-control" value={form.destination} onChange={set('destination')} /></Field>
          <Field label="Expected delivery">
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
          {form.truck_ownership === 'OWNED' ? (
            <>
              <Field label="Vehicle">
                <select className="form-select" value={form.vehicle} onChange={set('vehicle')}>
                  <option value="">—</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration_number}</option>)}
                </select>
              </Field>
              <Field label="Driver">
                <select className="form-select" value={form.driver} onChange={set('driver')}>
                  <option value="">—</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Transporter">
                <select className="form-select" value={form.transporter} onChange={set('transporter')}>
                  <option value="">—</option>
                  {transporters.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              </Field>
              <Field label="Hired truck">
                <select className="form-select" value={form.hired_truck} onChange={set('hired_truck')}>
                  <option value="">—</option>
                  {hiredTrucks.map((t) => <option key={t.id} value={t.id}>{t.registration_number}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>

        <h6 className="modal-section-title"><i className="bi bi-droplet-half" aria-hidden="true"></i>Lines</h6>
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Purchase price</th>
                  <th className="text-right">Selling price</th>
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
                    <td><input type="number" step="0.000001" className="form-control num" value={l.purchase_price} onChange={(e) => setLine(i, 'purchase_price', e.target.value)} /></td>
                    <td><input type="number" step="0.000001" className="form-control num" value={l.selling_price} onChange={(e) => setLine(i, 'selling_price', e.target.value)} /></td>
                    <td>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-icon"
                          title="Remove line"
                          aria-label="Remove line"
                          onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                        >
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
        <button
          type="button"
          className="btn btn-sm btn-secondary mt-2"
          onClick={() => setLines((ls) => [...ls, { product: '', quantity: '', purchase_price: '', selling_price: '' }])}
        >
          <i className="bi bi-plus-lg"></i> Add line
        </button>

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