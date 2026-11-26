/**
 * Transport bookings.
 * - CRUD /transport-bookings/ (withSubmit)
 * - POST /transport-bookings/:id/submit/
 * - GET  /transport-bookings/suggest-rate/?transporter=&origin=&destination=&date=
 * - GET  /transporters/... (for pickers), /transporter-vehicles/
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useApp } from '../../context/AppContext';
import api, { errorMessage, fieldErrors } from '../../services/api';
import Modal from '../../components/Modal';
import Field from '../../components/Field';
import Pagination, { usePagination } from '../../components/Pagination';
import TableSkeleton from '../../components/TableSkeleton';

const STATUSES = ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'IN_TRANSIT', 'DELIVERED', 'INVOICED', 'SETTLED', 'CANCELLED'];
const RATE_BASIS = ['PER_LITRE', 'PER_TRIP'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isNaN(x) ? String(n) : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const statusPill = (s) => {
  if (s === 'APPROVED' || s === 'DELIVERED') return 'status-pill--success';
  if (s === 'AWAITING_APPROVAL' || s === 'IN_TRANSIT') return 'status-pill--warning';
  if (s === 'INVOICED') return 'status-pill--info';
  if (s === 'CANCELLED') return 'status-pill--danger';
  return 'status-pill--neutral'; // DRAFT, SETTLED
};

export default function Bookings() {
  const { can } = useAuth();
  const { companyParams, activeCompanyObj, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.transportBookings.list({
        ...companyParams(),
        ordering: '-booking_date',
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        page_size: 500,
      });
      setRows(res?.results || res || []);
    } catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [companyParams, search, status]);

  useEffect(() => { load(); }, [load]);

  const submit = async (b) => {
    try {
      const res = await api.transportBookings.submit(b.id);
      notify(res.approval_request ? 'Sent for approval.' : 'Auto-approved.', 'success');
      load();
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const hasActiveFilters = !!(search || status);
  const clearFilters = () => { setSearch(''); setStatus(''); };
  const { pageRows, paginationProps } = usePagination(rows);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true"><i className="bi bi-calendar-check"></i></span>
          <div className="page-header__text">
            <h1 className="page-title">Transport bookings</h1>
            <p className="page-subtitle">
              Hired truck bookings{activeCompanyObj ? ` · ${activeCompanyObj.name}` : ''}
            </p>
          </div>
        </div>
        <div className="page-header__actions">
          {can('transport.edit') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <i className="bi bi-plus-lg"></i>
              New booking
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
              aria-label="Search bookings"
            />
            {search && (
              <button type="button" className="search-bar__clear" onClick={() => setSearch('')} aria-label="Clear search">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
          </div>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
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
                Status: {status.replace('_', ' ')}
                <button onClick={() => setStatus('')}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}

        <div className="table-wrap__header" style={{ borderTop: '1px solid var(--border-color)' }}>
          <span className="panel-title">
            <i className="bi bi-list-ul text-brand"></i>
            Booking List
          </span>
          <span className="chart-card__subtitle">
            {rows.length} booking{rows.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={10} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-calendar-check"></i>
            <h6>{hasActiveFilters ? 'No bookings match your search' : 'No bookings yet'}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? 'Try adjusting your search or filters' : "Click 'New booking' to add the first one"}
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
                    <th>Transporter</th>
                    <th>Truck</th>
                    <th className="text-right">Qty (L)</th>
                    <th>Rate basis</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                    <th className="text-center" style={{ width: '9rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((b) => (
                    <tr key={b.id}>
                      <td className="cell-mono text-brand fw-600">{b.reference}</td>
                      <td>{b.booking_date}</td>
                      <td className="cell-name">{b.transporter_label || b.transporter}</td>
                      <td className="cell-mono">{b.truck_label || b.truck}</td>
                      <td className="cell-num">{Number(b.quantity || 0).toLocaleString()}</td>
                      <td><span className="badge badge-neutral">{b.rate_basis.replace('_', ' ')}</span></td>
                      <td className="cell-num">{fmtMoney(b.total_charge)}</td>
                      <td className="cell-num">{fmtMoney(b.balance_payable)}</td>
                      <td><span className={`status-pill ${statusPill(b.status)}`}>{b.status.replace('_', ' ')}</span></td>
                      <td>
                        {b.status === 'DRAFT' && can('transport.edit') && (
                          <div className="row-actions">
                            <button className="btn btn-sm btn-primary" onClick={() => submit(b)}>Submit</button>
                            <button className="btn btn-icon" title="Edit" aria-label="Edit" onClick={() => setEditing(b)}>
                              <i className="bi bi-pencil"></i>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && <Pagination {...paginationProps} />}
      </section>

      {editing && (
        <BookingModal
          row={editing}
          companyParams={companyParams}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); notify('Saved.', 'success'); load(); }}
        />
      )}
    </div>
  );
}

function BookingModal({ row, companyParams, onClose, onSaved }) {
  const { notify } = useApp();
  const isNew = !row.id;
  const [transporters, setTransporters] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [products, setProducts] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [form, setForm] = useState({
    shipment: row.shipment || '', transporter: row.transporter || '', truck: row.truck || '',
    driver_name: row.driver_name || '', product: row.product || '', quantity: row.quantity ?? '',
    booking_date: row.booking_date || todayISO(), origin: row.origin || '', destination: row.destination || '',
    rate_basis: row.rate_basis || 'PER_LITRE', contracted_rate: row.contracted_rate ?? '',
    expected_delivery: row.expected_delivery || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    Promise.all([
      api.transporters.listAll({ ...companyParams() }),
      api.transporterVehicles.listAll({ ...companyParams(), kind: 'TRUCK' }),
      api.products.listAll(),
      api.shipments.listAll({ ...companyParams() }).catch(() => []),
    ]).then(([t, tr, p, s]) => { setTransporters(t); setTrucks(tr); setProducts(p); setShipments(s); }).catch(() => {});
  }, [companyParams]);

  const suggestRate = async () => {
    if (!form.transporter || !form.origin || !form.destination) {
      notify('Select a transporter and enter origin and destination first.', 'error');
      return;
    }
    try {
      const r = await api.transportBookings.suggestRate({
        transporter: form.transporter, origin: form.origin,
        destination: form.destination, date: form.booking_date,
      });
      if (r.rate_per_litre) setForm((f) => ({ ...f, rate_basis: 'PER_LITRE', contracted_rate: r.rate_per_litre }));
      else if (r.rate_per_trip) setForm((f) => ({ ...f, rate_basis: 'PER_TRIP', contracted_rate: r.rate_per_trip }));
      else notify('No rate found for this route.', 'error');
    } catch (err) { notify(errorMessage(err), 'error'); }
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(''); setFieldErr({});
    try {
      const body = { ...form, company: companyParams().company };
      ['shipment', 'expected_delivery'].forEach((k) => { if (!body[k]) delete body[k]; });
      isNew ? await api.transportBookings.create(body) : await api.transportBookings.update(row.id, body);
      onSaved();
    } catch (err) { setError(errorMessage(err)); setFieldErr(fieldErrors(err)); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      show
      onClose={onClose}
      title={isNew ? 'New booking' : `Edit ${row.reference}`}
      subtitle="Hired truck bookings"
      icon="bi-calendar-check"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="submit" form="bookingForm" disabled={busy}>
            <i className="bi bi-save"></i>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <form id="bookingForm" onSubmit={submit}>
        <h6 className="modal-section-title"><i className="bi bi-truck" aria-hidden="true"></i>Truck & Cargo</h6>
        <div className="form-grid">
          <Field label="Transporter" required err={fieldErr.transporter}>
            <select className="form-select" value={form.transporter} onChange={set('transporter')} required>
              <option value="">—</option>
              {transporters.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </select>
          </Field>
          <Field label="Truck" required err={fieldErr.truck}>
            <select className="form-select" value={form.truck} onChange={set('truck')} required>
              <option value="">—</option>
              {trucks
                .filter((t) => !form.transporter || String(t.transporter) === String(form.transporter))
                .map((t) => <option key={t.id} value={t.id}>{t.registration_number}</option>)}
            </select>
          </Field>
          <Field label="Driver name">
            <input className="form-control" value={form.driver_name} onChange={set('driver_name')} />
          </Field>
          <Field label="Product" required err={fieldErr.product}>
            <select className="form-select" value={form.product} onChange={set('product')} required>
              <option value="">—</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </Field>
          <Field label="Quantity (L)" required err={fieldErr.quantity}>
            <input type="number" step="0.001" className="form-control num" value={form.quantity} onChange={set('quantity')} required />
          </Field>
          <Field label="Shipment (link)">
            <select className="form-select" value={form.shipment} onChange={set('shipment')}>
              <option value="">—</option>
              {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference}</option>)}
            </select>
          </Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-geo-alt" aria-hidden="true"></i>Route & Schedule</h6>
        <div className="form-grid">
          <Field label="Booking date" required>
            <input type="date" className="form-control" value={form.booking_date} onChange={set('booking_date')} required />
          </Field>
          <Field label="Expected delivery">
            <input type="date" className="form-control" value={form.expected_delivery} onChange={set('expected_delivery')} />
          </Field>
          <Field label="Origin"><input className="form-control" value={form.origin} onChange={set('origin')} /></Field>
          <Field label="Destination"><input className="form-control" value={form.destination} onChange={set('destination')} /></Field>
        </div>

        <h6 className="modal-section-title"><i className="bi bi-cash-coin" aria-hidden="true"></i>Rate</h6>
        <div className="form-grid">
          <Field label="Rate basis">
            <select className="form-select" value={form.rate_basis} onChange={set('rate_basis')}>
              {RATE_BASIS.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Contracted rate" required err={fieldErr.contracted_rate}>
            <div className="input-group">
              <input type="number" step="0.000001" className="form-control num" value={form.contracted_rate}
                     onChange={set('contracted_rate')} required />
              <button type="button" className="btn btn-secondary" onClick={suggestRate}>
                <i className="bi bi-magic"></i> Suggest
              </button>
            </div>
          </Field>
        </div>
        <p className="text-muted-soft mt-3" style={{ fontSize: '0.8125rem' }}>
          Total charge is calculated server-side: {form.rate_basis === 'PER_LITRE' ? 'qty × rate' : 'flat rate'}.
        </p>

        {error && <div className="alert alert-danger mt-3" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}